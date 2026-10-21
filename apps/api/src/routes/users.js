import { Router } from 'express'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { z } from 'zod'
import { AVAILABILITY, LEVELS, SPECIALTIES } from '../constants.js'
import { User } from '../models.js'
import { ApiError, asyncHandler } from '../lib/errors.js'
import { logAudit, pick } from '../lib/audit.js'
import { emitTo } from '../lib/realtime.js'
import { authenticate, requireLevel } from '../middleware/auth.js'
import { reassignOpenCases } from '../services/assignment.js'

const router = Router()
router.use(authenticate)

const AUDITED_FIELDS = ['name', 'email', 'level', 'isActive', 'specialties', 'availability', 'maxActiveCases']
const ENGINEER_FIELDS = 'name email specialties availability activeCaseCount maxActiveCases'

const level = z.number().int().min(0).max(3)
const specialties = z.array(z.enum(SPECIALTIES)).max(SPECIALTIES.length)
const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  level,
  specialties: specialties.optional(),
  maxActiveCases: z.number().int().min(1).max(50).optional(),
}).strict()
const updateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  level,
  isActive: z.boolean(),
  specialties,
  maxActiveCases: z.number().int().min(1).max(50),
  availability: z.enum(AVAILABILITY),
  password: z.string().min(12).max(128),
}).partial().strict()
const availabilitySchema = z.object({ availability: z.enum(AVAILABILITY) }).strict()

async function releaseCases(req, user, cause) {
  const moves = await reassignOpenCases(req.auth.orgId, user._id, cause)
  for (const { report, from, to } of moves) {
    await logAudit(req, { action: 'report.assignment_changed', resourceType: 'Report', resourceId: report.id, before: { assignedTo: from }, after: { assignedTo: to, assignmentReason: report.assignmentReason } })
    emitTo(req, { users: [from, to, report.reporterId], staff: true }, 'report.updated', { id: report.id, number: report.number, status: report.status })
  }
}

router.get('/engineers', requireLevel(1), asyncHandler(async (req, res) => {
  const engineers = await User.find({ orgId: req.auth.orgId, level: 1, isActive: true }).select(ENGINEER_FIELDS).sort({ name: 1 }).lean()
  res.json({ data: engineers, requestId: req.id })
}))

router.patch('/me/availability', requireLevel(1), asyncHandler(async (req, res) => {
  if (req.auth.level !== 1) throw new ApiError(403, 'FORBIDDEN', 'Only Cybersecurity Engineers have an availability status')
  const { availability } = availabilitySchema.parse(req.body)
  const user = req.auth.user
  const before = pick(user, ['availability'])
  user.availability = availability
  await user.save()
  await logAudit(req, { action: 'user.availability_changed', resourceType: 'User', resourceId: user.id, before, after: { availability } })
  if (availability === 'offline') await releaseCases(req, user, 'engineer went offline')
  emitTo(req, { staff: true }, 'user.updated', { id: user.id, availability })
  res.json({ data: pick(user, ['availability', 'activeCaseCount']), requestId: req.id })
}))

router.use(requireLevel(3))

router.get('/', asyncHandler(async (req, res) => {
  const users = await User.find({ orgId: req.auth.orgId }).sort({ level: -1, name: 1 }).lean()
  res.json({ data: users, requestId: req.id })
}))

router.post('/', asyncHandler(async (req, res) => {
  const { password, ...input } = createSchema.parse(req.body)
  let user
  try {
    user = await User.create({ ...input, orgId: req.auth.orgId, title: LEVELS[input.level], passwordHash: await bcrypt.hash(password, 12) })
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account with that email already exists')
    throw error
  }
  await logAudit(req, { action: 'user.created', resourceType: 'User', resourceId: user.id, after: pick(user, AUDITED_FIELDS) })
  res.status(201).json({ data: user, requestId: req.id })
}))

router.patch('/:id', asyncHandler(async (req, res) => {
  const { password, ...input } = updateSchema.parse(req.body)
  const user = mongoose.isValidObjectId(req.params.id) && await User.findOne({ _id: req.params.id, orgId: req.auth.orgId })
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User was not found')
  if (user.id === req.auth.user.id && (input.isActive === false || (input.level !== undefined && input.level < 3))) {
    throw new ApiError(409, 'SELF_LOCKOUT', 'You cannot deactivate or demote your own account')
  }

  const before = pick(user, AUDITED_FIELDS)
  const wasEngineer = user.level === 1
  user.set({ ...input, ...(input.level !== undefined && { title: LEVELS[input.level] }) })
  if (password) user.passwordHash = await bcrypt.hash(password, 12)
  await user.save()

  const leftDuty = wasEngineer && (!user.isActive || user.level !== 1 || user.availability === 'offline')
  if (leftDuty) await releaseCases(req, user, 'engineer unavailable')
  await logAudit(req, { action: password ? 'user.updated_with_password_reset' : 'user.updated', resourceType: 'User', resourceId: user.id, before, after: pick(user, AUDITED_FIELDS) })
  emitTo(req, { staff: true }, 'user.updated', { id: user.id })
  res.json({ data: user, requestId: req.id })
}))

export default router
