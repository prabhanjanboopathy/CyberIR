import { AuditLog } from '../models.js'

export async function writeAudit({ orgId, actorId = null, action, resourceType, resourceId, before = null, after = null, requestId, session }) {
  const [event] = await AuditLog.create(
    [{ orgId, actorId, action, resourceType, resourceId: String(resourceId), before, after, requestId }],
    session ? { session } : undefined,
  )
  return event
}

export const logAudit = (req, { action, resourceType, resourceId, before, after }) =>
  writeAudit({ orgId: req.auth.orgId, actorId: req.auth.userId, action, resourceType, resourceId, before, after, requestId: req.id })

export const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, source[key] ?? null]))
