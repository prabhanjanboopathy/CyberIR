import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { ATTACK_TYPES, DONE_STATUSES, ENGINEER_STATUSES, SEVERITIES, STATUSES } from '../constants.js'
import { HelpRequest, ReassignmentRequest, Report, User } from '../models.js'
import { ApiError, asyncHandler } from '../lib/errors.js'
import { logAudit } from '../lib/audit.js'
import { emitTo } from '../lib/realtime.js'
import { authenticate, requireLevel } from '../middleware/auth.js'
import { applyAssignment, recountActiveCases } from '../services/assignment.js'
import { createReport, findVisibleReport, presentReport, reportAudience, reportSnapshot, visibilityFilter } from '../services/reports.js'

const router = Router()
router.use(authenticate)

const score = z.number().int().min(1).max(5)
const objectIdSchema = z.string().refine(mongoose.isValidObjectId, 'Invalid id')
const createSchema = z.object({
  title: z.string().trim().min(5).max(140),
  description: z.string().trim().min(20).max(4000),
  attackType: z.enum(ATTACK_TYPES),
  affectedAsset: z.string().trim().min(2).max(120),
  impact: score,
  urgency: score,
  assetCriticality: score,
}).strict()
const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  attackType: z.enum(ATTACK_TYPES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  assignee: z.union([objectIdSchema, z.literal('unassigned')]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
const statusSchema = z.object({
  status: z.enum(STATUSES).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  note: z.string().trim().min(1).max(4000).optional(),
}).strict().refine((input) => input.status || input.progress !== undefined || input.note, 'Provide a status, progress, or note')
const assignmentSchema = z.object({
  assigneeId: objectIdSchema.nullable().optional(),
  collaboratorIds: z.array(objectIdSchema).max(10).optional(),
  reason: z.string().trim().min(3).max(300).optional(),
}).strict().refine((input) => input.assigneeId !== undefined || input.collaboratorIds, 'Provide an assignee or collaborators')
const severitySchema = z.object({ severity: z.enum(SEVERITIES), justification: z.string().trim().min(10).max(1000) }).strict()
const noteSchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict()

const populateList = [{ path: 'assignedTo', select: 'name title' }, { path: 'reporterId', select: 'name' }]

router.post('/', asyncHandler(async (req, res) => {
  const report = await createReport({ orgId: req.auth.orgId, reporterId: req.auth.userId, input: createSchema.parse(req.body) })
  await logAudit(req, { action: 'report.created', resourceType: 'Report', resourceId: report.id, after: { number: report.number, ...reportSnapshot(report), assignmentReason: report.assignmentReason } })
  emitTo(req, { users: [report.assignedTo], staff: true }, 'report.created', { id: report.id, number: report.number, assignedTo: report.assignedTo })
  if (!report.assignedTo) emitTo(req, { staff: true }, 'report.unassigned', { id: report.id, number: report.number, title: report.title })
  res.status(201).json({ data: presentReport(report, req.auth.level), requestId: req.id })
}))

router.get('/', asyncHandler(async (req, res) => {
  const query = listSchema.parse(req.query)
  const filter = visibilityFilter(req.auth)
  if (query.status) filter.status = query.status
  if (query.attackType) filter.attackType = query.attackType
  if (query.severity) filter.severity = query.severity
  if (query.assignee && req.auth.level >= 2) filter.assignedTo = query.assignee === 'unassigned' ? null : query.assignee
  const reports = await Report.find(filter).select('-notes -assignmentHistory').sort({ createdAt: -1 }).limit(query.limit).populate(populateList)
  res.json({ data: reports.map((report) => presentReport(report, req.auth.level)), requestId: req.id })
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const report = await (await findVisibleReport(req.auth, req.params.id)).populate([...populateList, { path: 'collaborators', select: 'name' }])
  const data = presentReport(report, req.auth.level)
  if (req.auth.level > 0) {
    const [helpRequests, reassignmentRequests] = await Promise.all([
      HelpRequest.find({ reportId: report._id }).sort({ createdAt: -1 }).populate('requesterId targetId', 'name').lean(),
      ReassignmentRequest.find({ reportId: report._id }).sort({ createdAt: -1 }).populate('requesterId decidedBy', 'name').lean(),
    ])
    Object.assign(data, { helpRequests, reassignmentRequests })
  }
  res.json({ data, requestId: req.id })
}))

router.patch('/:id/status', requireLevel(1), asyncHandler(async (req, res) => {
  const input = statusSchema.parse(req.body)
  const report = await findVisibleReport(req.auth, req.params.id)
  const isAssignee = String(report.assignedTo) === String(req.auth.userId)
  if (req.auth.level === 1 && !isAssignee) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned engineer can update this case')
  if (req.auth.level === 1 && input.status && !ENGINEER_STATUSES.includes(input.status)) throw new ApiError(403, 'FORBIDDEN', `Engineers can only set: ${ENGINEER_STATUSES.join(', ')}`)

  const before = reportSnapshot(report)
  if (input.status) {
    report.status = input.status
    report.closedAt = DONE_STATUSES.includes(input.status) ? (report.closedAt ?? new Date()) : undefined
    if (DONE_STATUSES.includes(input.status)) report.progress = 100
  }
  if (input.progress !== undefined) report.progress = input.progress
  if (input.note) report.notes.push({ authorId: req.auth.userId, authorName: req.auth.user.name, body: input.note })
  await report.save()
  await recountActiveCases(report.orgId, [report.assignedTo])
  await logAudit(req, { action: 'report.updated', resourceType: 'Report', resourceId: report.id, before, after: reportSnapshot(report) })
  emitTo(req, reportAudience(report), 'report.updated', { id: report.id, number: report.number, status: report.status })
  res.json({ data: presentReport(report, req.auth.level), requestId: req.id })
}))

router.patch('/:id/assignment', requireLevel(2), asyncHandler(async (req, res) => {
  const input = assignmentSchema.parse(req.body)
  const report = await findVisibleReport(req.auth, req.params.id)
  const before = reportSnapshot(report)
  const previousPeople = [report.assignedTo, ...report.collaborators]

  const wanted = new Set([input.assigneeId, ...(input.collaboratorIds ?? [])].filter(Boolean))
  const engineers = await User.countDocuments({ _id: { $in: [...wanted] }, orgId: req.auth.orgId, level: 1, isActive: true })
  if (engineers !== wanted.size) throw new ApiError(400, 'INVALID_ENGINEER', 'Assignee and collaborators must be active Cybersecurity Engineers')

  if (input.assigneeId !== undefined && String(input.assigneeId ?? '') !== String(report.assignedTo ?? '')) {
    await applyAssignment(report, input.assigneeId, String(req.auth.userId), input.reason ?? 'manual assignment by Risk Analyst')
  }
  if (input.collaboratorIds) {
    report.collaborators = input.collaboratorIds.filter((id) => id !== String(report.assignedTo))
    await report.save()
  }
  await logAudit(req, { action: 'report.assignment_changed', resourceType: 'Report', resourceId: report.id, before, after: reportSnapshot(report) })
  emitTo(req, reportAudience(report, ...previousPeople), 'report.updated', { id: report.id, number: report.number, status: report.status })
  res.json({ data: presentReport(report, req.auth.level), requestId: req.id })
}))

router.patch('/:id/severity', requireLevel(2), asyncHandler(async (req, res) => {
  const input = severitySchema.parse(req.body)
  const report = await findVisibleReport(req.auth, req.params.id)
  const before = reportSnapshot(report)
  report.severityOverride = { previous: report.severity, justification: input.justification, actorId: req.auth.userId, at: new Date() }
  report.severity = input.severity
  await report.save()
  await logAudit(req, { action: 'report.severity_overridden', resourceType: 'Report', resourceId: report.id, before, after: { ...reportSnapshot(report), justification: input.justification } })
  emitTo(req, reportAudience(report), 'report.updated', { id: report.id, number: report.number, status: report.status })
  res.json({ data: presentReport(report, req.auth.level), requestId: req.id })
}))

router.post('/:id/notes', requireLevel(1), asyncHandler(async (req, res) => {
  const { body } = noteSchema.parse(req.body)
  const report = await findVisibleReport(req.auth, req.params.id)
  report.notes.push({ authorId: req.auth.userId, authorName: req.auth.user.name, body })
  await report.save()
  await logAudit(req, { action: 'report.note_added', resourceType: 'Report', resourceId: report.id, after: { note: body } })
  emitTo(req, reportAudience(report), 'report.updated', { id: report.id, number: report.number, status: report.status })
  res.status(201).json({ data: presentReport(report, req.auth.level), requestId: req.id })
}))

export default router
