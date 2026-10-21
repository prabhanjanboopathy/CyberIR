import { Router } from 'express'
import { Report } from '../models.js'
import { asyncHandler } from '../lib/errors.js'
import { DONE_STATUSES } from '../constants.js'
import { authenticate } from '../middleware/auth.js'
import { visibilityFilter } from '../services/reports.js'

const router = Router()
router.use(authenticate)

const countBy = (field) => [{ $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }]

router.get('/summary', asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const [result] = await Report.aggregate([
    { $match: visibilityFilter(req.auth) },
    { $facet: {
      byStatus: countBy('status'),
      bySeverity: countBy('severity'),
      byAttackType: countBy('attackType'),
      totals: [{ $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $in: ['$status', DONE_STATUSES] }, 0, 1] } },
        unassigned: { $sum: { $cond: [{ $and: [{ $eq: ['$assignedTo', null] }, { $not: [{ $in: ['$status', DONE_STATUSES] }] }] }, 1, 0] } },
      } }],
      daily: [
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ],
    } },
  ])
  res.json({ data: { ...result, totals: result.totals[0] ?? { total: 0, active: 0, unassigned: 0 } }, requestId: req.id })
}))

export default router
