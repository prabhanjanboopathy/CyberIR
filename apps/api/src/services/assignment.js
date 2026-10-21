import { DONE_STATUSES, SPECIALTY_FOR_ATTACK } from '../constants.js'
import { Report, User } from '../models.js'

const PRIMARY = 2
const SECONDARY = 1

export function specialtyScore(engineer, attackType) {
  const specialty = SPECIALTY_FOR_ATTACK[attackType]
  if (!specialty) return 0
  if (engineer.specialties?.[0] === specialty) return PRIMARY
  return engineer.specialties?.includes(specialty) ? SECONDARY : 0
}

const isEligible = (engineer, excluded) => engineer.level === 1
  && engineer.isActive
  && engineer.availability === 'available'
  && engineer.activeCaseCount < engineer.maxActiveCases
  && !excluded.has(String(engineer._id))

function describe(score, specialistExists) {
  if (score === PRIMARY) return 'primary specialty match'
  const basis = score === SECONDARY ? 'secondary specialty match' : 'lowest workload'
  return specialistExists ? `fallback: specialist unavailable (${basis})` : basis
}

export function chooseAssignee(engineers, attackType, excludeIds = []) {
  const excluded = new Set(excludeIds.map(String))
  const best = engineers
    .filter((engineer) => isEligible(engineer, excluded))
    .map((engineer) => ({ engineer, score: specialtyScore(engineer, attackType) }))
    .sort((a, b) => b.score - a.score || a.engineer.activeCaseCount - b.engineer.activeCaseCount)[0]
  if (!best) return null
  const specialistExists = engineers.some((engineer) => engineer.isActive && specialtyScore(engineer, attackType) === PRIMARY)
  return { engineer: best.engineer, reason: describe(best.score, specialistExists) }
}

export async function recountActiveCases(orgId, userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))]
  await Promise.all(ids.map(async (id) => {
    const activeCaseCount = await Report.countDocuments({ orgId, assignedTo: id, status: { $nin: DONE_STATUSES } })
    await User.updateOne({ _id: id, orgId, level: 1 }, { $set: { activeCaseCount } })
  }))
}

export async function applyAssignment(report, assigneeId, by, reason) {
  const previous = report.assignedTo
  report.assignedTo = assigneeId
  report.assignedBy = by
  report.assignmentReason = reason
  report.assignmentHistory.push({ from: previous, to: assigneeId, by, reason })
  if (assigneeId) report.collaborators.pull(assigneeId)
  await report.save()
  await recountActiveCases(report.orgId, [previous, assigneeId])
}

export async function autoAssign(report, { excludeIds = [], by = 'auto', cause } = {}) {
  const engineers = await User.find({ orgId: report.orgId, level: 1, isActive: true }).lean()
  const choice = chooseAssignee(engineers, report.attackType, excludeIds)
  if (choice) await applyAssignment(report, choice.engineer._id, by, cause ? `${cause}: ${choice.reason}` : choice.reason)
  else if (!report.assignedTo) await applyAssignment(report, null, by, 'no available engineer')
  return choice?.engineer ?? null
}

export async function reassignOpenCases(orgId, userId, cause) {
  const reports = await Report.find({ orgId, assignedTo: userId, status: { $nin: DONE_STATUSES } })
  const moves = []
  for (const report of reports) {
    const assignedTo = await autoAssign(report, { excludeIds: [userId], cause })
    if (assignedTo) moves.push({ report, from: userId, to: assignedTo._id })
  }
  return moves
}
