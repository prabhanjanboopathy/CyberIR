import { createHash, randomUUID } from 'node:crypto'
import multer from 'multer'
import mongoose from 'mongoose'
import { Router } from 'express'
import { z } from 'zod'
import { CustodyEvent, Evidence } from '../models.js'
import { ApiError, asyncHandler } from '../lib/errors.js'
import { writeAudit } from '../lib/audit.js'
import { emitTo } from '../lib/realtime.js'
import { authenticate, requireLevel } from '../middleware/auth.js'
import { findVisibleReport, reportAudience } from '../services/reports.js'
import { evidenceStorageProvider, readEvidence, removeEvidence, storeEvidence } from '../lib/evidenceStorage.js'
import { scanEvidenceBuffer } from '../lib/clamav.js'
import { validateEvidenceFile } from '../lib/evidenceValidation.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } })
router.use(authenticate)

function toId(value) {
  return String(value?._id ?? value ?? '')
}

function eventPayload({ orgId, reportId, evidenceId, sequence, actorId, action, reason, occurredAt, previousHash }) {
  return {
    orgId: toId(orgId),
    reportId: toId(reportId),
    evidenceId: toId(evidenceId),
    sequence,
    actorId: actorId ? toId(actorId) : null,
    action,
    reason: reason ?? null,
    occurredAt: new Date(occurredAt).toISOString(),
    previousHash: previousHash ?? null,
  }
}

function eventHash(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function appendCustodyEvent({ evidence, actorId, action, reason = null, session }) {
  const occurredAt = new Date()
  const sequence = evidence.custodySequence + 1
  const previousHash = evidence.lastCustodyHash ?? null
  const payload = eventPayload({
    orgId: evidence.orgId,
    reportId: evidence.reportId,
    evidenceId: evidence._id,
    sequence,
    actorId,
    action,
    reason,
    occurredAt,
    previousHash,
  })
  const hash = eventHash(payload)
  await CustodyEvent.create([{
    orgId: evidence.orgId,
    reportId: evidence.reportId,
    evidenceId: evidence._id,
    sequence,
    actorId,
    action,
    reason,
    occurredAt,
    previousHash,
    eventHash: hash,
  }], { session })
  evidence.custodySequence = sequence
  evidence.lastCustodyHash = hash
  await evidence.save({ session })
  return hash
}

function serializeEvidence(evidence) {
  return {
    id: toId(evidence._id ?? evidence.id),
    reportId: toId(evidence.reportId),
    uploadedBy: toId(evidence.uploadedBy),
    originalName: evidence.originalName,
    contentType: evidence.contentType,
    size: evidence.size,
    sha256: evidence.sha256,
    scanStatus: evidence.scanStatus,
    classification: evidence.classification,
    uploadedAt: evidence.createdAt,
    retentionUntil: evidence.retentionUntil,
  }
}

async function getEvidence(req, evidenceId) {
  if (!mongoose.isValidObjectId(evidenceId)) throw new ApiError(404, 'NOT_FOUND', 'Evidence was not found')
  const evidence = await Evidence.findOne({ _id: evidenceId, orgId: req.auth.orgId, deletedAt: null })
  if (!evidence) throw new ApiError(404, 'NOT_FOUND', 'Evidence was not found')
  await findVisibleReport(req.auth, evidence.reportId)
  return evidence
}

router.post('/reports/:reportId/evidence', upload.single('file'), asyncHandler(async (req, res) => {
  const report = await findVisibleReport(req.auth, req.params.reportId)
  const file = req.file
  const validated = await validateEvidenceFile(file)
  const input = z.object({ classification: z.enum(['internal', 'confidential', 'restricted']).default('confidential') }).parse(req.body)
  const sha256 = createHash('sha256').update(file.buffer).digest('hex')
  const evidenceId = new mongoose.Types.ObjectId()
  const objectKey = `${req.auth.orgId}/reports/${report.id}/evidence/${evidenceId}-${randomUUID()}`
  const storageProvider = evidenceStorageProvider()
  const scanStatus = await scanEvidenceBuffer(file.buffer)

  await storeEvidence({ key: objectKey, buffer: file.buffer, contentType: validated.contentType, sha256 })
  const session = await mongoose.startSession()
  let evidence
  try {
    await session.withTransaction(async () => {
      ;[evidence] = await Evidence.create([{
        _id: evidenceId,
        orgId: req.auth.orgId,
        reportId: report._id,
        uploadedBy: req.auth.userId,
        objectKey,
        storageProvider,
        originalName: validated.originalName,
        contentType: validated.contentType,
        size: file.size,
        sha256,
        scanStatus,
        classification: input.classification,
      }], { session })
      await appendCustodyEvent({ evidence, actorId: req.auth.userId, action: scanStatus === 'infected' ? 'quarantined' : 'uploaded', session })
      await writeAudit({ orgId: req.auth.orgId, actorId: req.auth.userId, action: 'evidence.uploaded', resourceType: 'Evidence', resourceId: evidence.id, after: { reportId: report.id, sha256, size: file.size, scanStatus }, requestId: req.id, session })
    })
  } catch (error) {
    await removeEvidence({ key: objectKey, provider: storageProvider }).catch(() => undefined)
    throw error
  } finally {
    await session.endSession()
  }

  emitTo(req, reportAudience(report), 'evidence.created', { reportId: report.id, evidenceId: evidence.id })
  res.status(201).json({ data: serializeEvidence(evidence), requestId: req.id })
}))

router.get('/reports/:reportId/evidence', asyncHandler(async (req, res) => {
  const report = await findVisibleReport(req.auth, req.params.reportId)
  const items = await Evidence.find({ orgId: req.auth.orgId, reportId: report._id, deletedAt: null }).sort({ createdAt: -1 }).lean()
  res.json({ data: items.map(serializeEvidence), requestId: req.id })
}))

router.get('/evidence/:evidenceId/custody', asyncHandler(async (req, res) => {
  const evidence = await getEvidence(req, req.params.evidenceId)
  const events = await CustodyEvent.find({ orgId: req.auth.orgId, evidenceId: evidence._id }).sort({ sequence: 1 }).lean()
  let previousHash = null
  let integrityValid = true
  const data = events.map((event) => {
    const payload = eventPayload(event)
    const expectedHash = eventHash(payload)
    if (event.previousHash !== previousHash || event.eventHash !== expectedHash) integrityValid = false
    previousHash = event.eventHash
    return { id: toId(event._id), sequence: event.sequence, actorId: toId(event.actorId), action: event.action, reason: event.reason, occurredAt: event.occurredAt, previousHash: event.previousHash, eventHash: event.eventHash }
  })
  res.json({ data, integrityValid, requestId: req.id })
}))

router.post('/evidence/:evidenceId/custody-events', requireLevel(1), asyncHandler(async (req, res) => {
  const input = z.object({ action: z.enum(['verified', 'quarantined']), reason: z.string().trim().min(8).max(1000) }).parse(req.body)
  const evidence = await getEvidence(req, req.params.evidenceId)
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      await appendCustodyEvent({ evidence, actorId: req.auth.userId, action: input.action, reason: input.reason, session })
      await writeAudit({ orgId: req.auth.orgId, actorId: req.auth.userId, action: `evidence.${input.action}`, resourceType: 'Evidence', resourceId: evidence.id, after: { reason: input.reason }, requestId: req.id, session })
    })
  } finally {
    await session.endSession()
  }
  res.status(201).json({ data: { evidenceId: evidence.id, sequence: evidence.custodySequence, eventHash: evidence.lastCustodyHash }, requestId: req.id })
}))

router.get('/evidence/:evidenceId/download', asyncHandler(async (req, res) => {
  const evidence = await getEvidence(req, req.params.evidenceId)
  if (evidence.scanStatus === 'infected' || (process.env.NODE_ENV === 'production' && evidence.scanStatus !== 'clean')) {
    throw new ApiError(423, 'EVIDENCE_QUARANTINED', 'Evidence is unavailable until a clean malware scan is recorded')
  }
  const buffer = await readEvidence({ key: evidence.objectKey, provider: evidence.storageProvider })
  const actualHash = createHash('sha256').update(buffer).digest('hex')
  if (actualHash !== evidence.sha256) throw new ApiError(409, 'EVIDENCE_TAMPERED', 'Stored evidence hash does not match its upload hash')
  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      await appendCustodyEvent({ evidence, actorId: req.auth.userId, action: 'downloaded', session })
      await writeAudit({ orgId: req.auth.orgId, actorId: req.auth.userId, action: 'evidence.downloaded', resourceType: 'Evidence', resourceId: evidence.id, after: { sha256: evidence.sha256 }, requestId: req.id, session })
    })
  } finally {
    await session.endSession()
  }
  res.setHeader('Content-Type', evidence.contentType)
  res.setHeader('Content-Length', String(buffer.length))
  res.setHeader('Content-Disposition', `attachment; filename="${evidence.originalName}"`)
  res.send(buffer)
}))

export default router
