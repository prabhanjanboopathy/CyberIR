import { Router } from 'express'
import { z } from 'zod'
import { AuditLog } from '../models.js'
import { asyncHandler } from '../lib/errors.js'
import { authenticate, requireLevel } from '../middleware/auth.js'

const router = Router()
router.use(authenticate, requireLevel(2))

const querySchema = z.object({
  resourceType: z.string().max(60).optional(),
  resourceId: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

router.get('/', asyncHandler(async (req, res) => {
  const query = querySchema.parse(req.query)
  const filter = { orgId: req.auth.orgId }
  if (query.resourceType) filter.resourceType = query.resourceType
  if (query.resourceId) filter.resourceId = query.resourceId
  if (req.auth.level < 3) filter.resourceType = query.resourceType === 'User' ? 'none' : (query.resourceType ?? { $ne: 'User' })
  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(query.limit).populate('actorId', 'name title').lean()
  res.json({ data: logs, requestId: req.id })
}))

export default router
