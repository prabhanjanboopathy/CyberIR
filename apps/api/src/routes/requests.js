import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { DONE_STATUSES } from '../constants.js'
import { HelpRequest, ReassignmentRequest, Report, User } from '../models.js'
import { ApiError, asyncHandler } from '../lib/errors.js'
import { logAudit, pick } from '../lib/audit.js'
import { emitTo } from '../lib/realtime.js'
import { authenticate, requireLevel } from '../middleware/auth.js'
import { autoAssign } from '../services/assignment.js'
import { findVisibleReport, reportAudience } from '../services/reports.js'

const router = Router()
router.use(authenticate)

const objectIdSchema = z.string().refine(mongoose.isValidObjectId, 'Invalid id')
const statusQuery = z.object({ status: z.enum(['pending', 'accepted', 'declined', 'approved', 'rejected']).optional() })
const helpSchema = z.object({ targetId: objectIdSchema, message: z.string().trim().min(5).max(1000) }).strict()
const helpDecisionSchema = z.object({ decision: z.enum(['accept', 'decline']) }).strict()
const reassignSchema = z.object({ reason: z.string().trim().min(15, 'Please explain the reason in at least 15 characters').max(1000) }).strict()
const reviewSchema = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().min(3).max(1000) }).strict()

async function findAssignedCase(req) {
  const report = await findVisibleReport(req.auth, req.params.id)
  if (String(report.assignedTo) !== String(req.auth.userId)) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned engineer can do this')
  if (DONE_STATUSES.includes(report.status)) throw new ApiError(409, 'CASE_CLOSED', 'This case is already completed')
  return report
}

async function findPending(Model, req) {
  const request = mongoose.isValidObjectId(req.params.id) && await Model.findOne({ _id: req.params.id, orgId: req.auth.orgId })
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Request was not found')
  if (request.status !== 'pending') throw new ApiError(409, 'ALREADY_DECIDED', 'This request has already been decided')
  return request
}

router.post('/reports/:id/help-requests', requireLevel(1), asyncHandler(async (req, res) => {
  const input = helpSchema.parse(req.body)
  const report = await findAssignedCase(req)
  const target = await User.findOne({ _id: input.targetId, orgId: req.auth.orgId, level: 1, isActive: true })
  const involved = [report.assignedTo, ...report.collaborators].map(String)
  if (!target || involved.includes(target.id)) throw new ApiError(400, 'INVALID_COLLEAGUE', 'Pick an active engineer who is not already on this case')
  if (await HelpRequest.exists({ reportId: report._id, targetId: target._id, status: 'pending' })) throw new ApiError(409, 'DUPLICATE_REQUEST', 'A help request to this engineer is already pending')

  const request = await HelpRequest.create({ orgId: req.auth.orgId, reportId: report._id, requesterId: req.auth.userId, targetId: target._id, message: input.message })
  await logAudit(req, { action: 'help_request.created', resourceType: 'HelpRequest', resourceId: request.id, after: { reportId: report.id, targetId: target.id, message: input.message } })
  emitTo(req, { users: [target._id] }, 'help-request.created', { id: request.id, reportNumber: report.number })
  res.status(201).json({ data: request, requestId: req.id })
}))

router.get('/help-requests', requireLevel(1), asyncHandler(async (req, res) => {
  const { status } = statusQuery.parse(req.query)
  const filter = { orgId: req.auth.orgId, targetId: req.auth.userId, ...(status && { status }) }
  const items = await HelpRequest.find(filter).sort({ createdAt: -1 }).limit(100)
    .populate('reportId', 'number title attackType severity').populate('requesterId', 'name').lean()
  res.json({ data: items, requestId: req.id })
}))

router.patch('/help-requests/:id', requireLevel(1), asyncHandler(async (req, res) => {
  const { decision } = helpDecisionSchema.parse(req.body)
  const request = await findPending(HelpRequest, req)
  if (String(request.targetId) !== String(req.auth.userId)) throw new ApiError(403, 'FORBIDDEN', 'Only the requested engineer can respond')

  const before = pick(request, ['status'])
  request.status = decision === 'accept' ? 'accepted' : 'declined'
  request.respondedAt = new Date()
  await request.save()
  const report = await Report.findOne({ _id: request.reportId, orgId: req.auth.orgId })
  if (decision === 'accept' && report) {
    await Report.updateOne({ _id: report._id }, { $addToSet: { collaborators: request.targetId } })
    report.collaborators.addToSet(request.targetId)
  }
  await logAudit(req, { action: `help_request.${request.status}`, resourceType: 'HelpRequest', resourceId: request.id, before, after: { status: request.status, reportId: request.reportId } })
  emitTo(req, { users: [request.requesterId, request.targetId], staff: true }, 'help-request.updated', { id: request.id, status: request.status, reportId: request.reportId })
  if (report) emitTo(req, reportAudience(report), 'report.updated', { id: report.id, number: report.number, status: report.status })
  res.json({ data: request, requestId: req.id })
}))

router.post('/reports/:id/reassignment-requests', requireLevel(1), asyncHandler(async (req, res) => {
  const { reason } = reassignSchema.parse(req.body)
  const report = await findAssignedCase(req)
  if (await ReassignmentRequest.exists({ reportId: report._id, status: 'pending' })) throw new ApiError(409, 'DUPLICATE_REQUEST', 'A reassignment request is already pending for this case')

  const request = await ReassignmentRequest.create({ orgId: req.auth.orgId, reportId: report._id, requesterId: req.auth.userId, reason })
  await logAudit(req, { action: 'reassignment_request.created', resourceType: 'ReassignmentRequest', resourceId: request.id, after: { reportId: report.id, reason } })
  emitTo(req, { staff: true }, 'reassignment-request.created', { id: request.id, reportNumber: report.number })
  res.status(201).json({ data: request, requestId: req.id })
}))

router.get('/reassignment-requests', requireLevel(2), asyncHandler(async (req, res) => {
  const { status } = statusQuery.parse(req.query)
  const items = await ReassignmentRequest.find({ orgId: req.auth.orgId, ...(status && { status }) }).sort({ createdAt: -1 }).limit(100)
    .populate({ path: 'reportId', select: 'number title attackType severity assignedTo', populate: { path: 'assignedTo', select: 'name' } })
    .populate('requesterId decidedBy', 'name').lean()
  res.json({ data: items, requestId: req.id })
}))

router.patch('/reassignment-requests/:id', requireLevel(2), asyncHandler(async (req, res) => {
  const input = reviewSchema.parse(req.body)
  const request = await findPending(ReassignmentRequest, req)
  const report = await Report.findOne({ _id: request.reportId, orgId: req.auth.orgId })
  const before = { status: request.status, assignedTo: report?.assignedTo }

  let newAssignee = null
  if (input.decision === 'approve') {
    if (!report || String(report.assignedTo) !== String(request.requesterId)) throw new ApiError(409, 'STALE_REQUEST', 'The case is no longer assigned to the requester')
    newAssignee = await autoAssign(report, { excludeIds: [request.requesterId], by: String(req.auth.userId), cause: 'reassignment approved' })
    if (!newAssignee) throw new ApiError(409, 'NO_AVAILABLE_ENGINEER', 'No other engineer is available; assign the case manually instead')
  }
  request.status = input.decision === 'approve' ? 'approved' : 'rejected'
  request.decidedBy = req.auth.userId
  request.decisionNote = input.note
  request.decidedAt = new Date()
  await request.save()

  await logAudit(req, { action: `reassignment_request.${request.status}`, resourceType: 'ReassignmentRequest', resourceId: request.id, before, after: { status: request.status, assignedTo: report?.assignedTo, decisionNote: input.note } })
  emitTo(req, { users: [request.requesterId, newAssignee?._id], staff: true }, 'reassignment-request.updated', { id: request.id, status: request.status })
  if (report) emitTo(req, reportAudience(report), 'report.updated', { id: report.id, number: report.number, status: report.status })
  res.json({ data: request, requestId: req.id })
}))

export default router
