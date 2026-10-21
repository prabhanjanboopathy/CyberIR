import mongoose from 'mongoose'
import { Counter, Report } from '../models.js'
import { ApiError } from '../lib/errors.js'
import { calculateSeverity } from '../lib/severity.js'
import { autoAssign } from './assignment.js'

const REPORTER_HIDDEN = new Set(['notes', 'assignmentHistory', 'assignedBy', 'assignmentReason', 'collaborators', 'assignedTo', 'severityOverride'])

export function visibilityFilter({ orgId, userId, level }) {
  if (level >= 2) return { orgId }
  if (level === 1) return { orgId, $or: [{ assignedTo: userId }, { collaborators: userId }] }
  return { orgId, reporterId: userId }
}

export async function findVisibleReport(auth, id) {
  const report = mongoose.isValidObjectId(id) && await Report.findOne({ _id: id, ...visibilityFilter(auth) })
  if (!report) throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
  return report
}

export function presentReport(report, level) {
  const plain = report.toObject?.() ?? report
  if (level > 0) return plain
  return Object.fromEntries(Object.entries(plain).filter(([key]) => !REPORTER_HIDDEN.has(key)))
}

export const reportAudience = (report, ...extraUserIds) => ({
  users: [report.reporterId, report.assignedTo, ...report.collaborators, ...extraUserIds],
  staff: true,
})

export const reportSnapshot = (report) => ({
  status: report.status,
  progress: report.progress,
  severity: report.severity,
  assignedTo: report.assignedTo,
  collaborators: [...report.collaborators],
})

async function nextNumber(orgId) {
  const year = new Date().getUTCFullYear()
  const counter = await Counter.findOneAndUpdate({ orgId, year }, { $inc: { sequence: 1 } }, { upsert: true, new: true })
  return `RPT-${year}-${String(counter.sequence).padStart(4, '0')}`
}

export async function createReport({ orgId, reporterId, input, createdAt }) {
  const { score, severity } = calculateSeverity(input)
  const report = new Report({
    ...input,
    orgId,
    reporterId,
    number: await nextNumber(orgId),
    severity,
    severityScore: score,
    ...(createdAt ? { createdAt } : {}),
  })
  await autoAssign(report)
  return report
}
