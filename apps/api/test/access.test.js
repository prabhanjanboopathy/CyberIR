import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { startTestServer } from './helpers.js'

const { Report, User } = await import('../src/models.js')

const REPORTER = 'reporter1@northstar.test'
const OTHER_REPORTER = 'reporter2@northstar.test'
const ANALYST = 'analyst@northstar.test'
const ADMIN = 'admin@northstar.test'
const MALWARE = 'engineer.malware@northstar.test'
const TROJAN = 'engineer.trojan@northstar.test'
const NETWORK = 'engineer.network@northstar.test'

const newReport = (attackType, title = 'Suspicious activity on workstation') => ({
  title,
  description: 'Detailed description of the suspicious activity observed.',
  attackType,
  affectedAsset: 'WS-001',
  impact: 3,
  urgency: 3,
  assetCriticality: 3,
})

let server
before(async () => { server = await startTestServer() })
after(() => server.stop())

test('seed creates exactly the 10 demo accounts and is idempotent', async () => {
  const { seedDemoData } = await import('../src/seedDemo.js')
  const reportCount = await Report.countDocuments()
  await seedDemoData({ password: 'Another-password-1!', orgSlug: 'northstar' })
  const users = await User.find().lean()
  assert.equal(users.length, 10)
  assert.deepEqual(users.map((user) => user.level).sort(), [0, 0, 0, 1, 1, 1, 1, 1, 2, 3])
  assert.equal(await Report.countDocuments(), reportCount)
  assert.equal(reportCount, 10)
})

test('unauthenticated requests are rejected', async () => {
  await request(server.app).get('/api/v1/reports').expect(401)
})

test('a new report is auto-assigned to the primary specialist and counts are synced', async () => {
  const created = await server.api('post', REPORTER, '/reports', newReport('Malware'))
  assert.equal(created.status, 201)
  const stored = await Report.findById(created.body.data._id).lean()
  const engineer = await User.findOne({ email: MALWARE }).lean()
  assert.equal(String(stored.assignedTo), String(engineer._id))
  assert.equal(stored.assignedBy, 'auto')
  assert.equal(stored.assignmentReason, 'primary specialty match')
  assert.equal(stored.assignmentHistory.length, 1)
  assert.equal(engineer.activeCaseCount, await Report.countDocuments({ assignedTo: engineer._id, status: { $nin: ['Completed', 'Closed'] } }))
  assert.equal(created.body.data.assignedTo, undefined)
})

test('an unavailable specialist triggers fallback assignment, and no engineers leaves the case unassigned', async () => {
  await server.api('patch', NETWORK, '/users/me/availability', { availability: 'busy' }).then((res) => assert.equal(res.status, 200))
  const fallback = await server.api('post', REPORTER, '/reports', newReport('DDoS'))
  const stored = await Report.findById(fallback.body.data._id).lean()
  assert.ok(stored.assignedTo)
  assert.notEqual(String(stored.assignedTo), String((await User.findOne({ email: NETWORK }))._id))

  await User.updateMany({ level: 1 }, { availability: 'offline' })
  const orphan = await server.api('post', REPORTER, '/reports', newReport('Other'))
  const unassigned = await Report.findById(orphan.body.data._id).lean()
  assert.equal(unassigned.assignedTo, null)
  assert.equal(unassigned.status, 'Yet to Assess')
  await User.updateMany({ level: 1 }, { availability: 'available' })
})

test('reporters only see their own reports', async () => {
  const mine = await server.api('get', REPORTER, '/reports')
  assert.ok(mine.body.data.length > 0)
  const other = await server.api('get', OTHER_REPORTER, '/reports')
  const ownIds = new Set(other.body.data.map((report) => report._id))
  assert.ok(mine.body.data.every((report) => !ownIds.has(report._id)))
  const foreign = await server.api('get', OTHER_REPORTER, `/reports/${mine.body.data[0]._id}`)
  assert.equal(foreign.status, 404)
})

test('engineers only see their own cases and cannot reach level 2 routes', async () => {
  const engineer = await User.findOne({ email: TROJAN }).lean()
  const list = await server.api('get', TROJAN, '/reports')
  assert.ok(list.body.data.every((report) => String(report.assignedTo?._id) === String(engineer._id) || report.collaborators?.includes(String(engineer._id))))
  const all = await server.api('get', ANALYST, '/reports')
  assert.ok(all.body.data.length > list.body.data.length)
  for (const path of ['/audit-logs', '/reassignment-requests']) {
    assert.equal((await server.api('get', TROJAN, path)).status, 403)
    assert.equal((await server.api('get', REPORTER, path)).status, 403)
    assert.equal((await server.api('get', ANALYST, path)).status, 200)
  }
})

test('only level 3 can manage users', async () => {
  assert.equal((await server.api('get', ANALYST, '/users')).status, 403)
  assert.equal((await server.api('get', ADMIN, '/users')).status, 200)
  const created = await server.api('post', ADMIN, '/users', { name: 'New Engineer', email: 'new.engineer@northstar.test', password: 'Strong-password-123', level: 1, specialties: ['Malware'] })
  assert.equal(created.status, 201)
  assert.equal(created.body.data.passwordHash, undefined)
  assert.equal(created.body.data.title, 'Cybersecurity Engineer')
  const self = await server.api('patch', ADMIN, `/users/${(await User.findOne({ email: ADMIN }))._id}`, { isActive: false })
  assert.equal(self.status, 409)
  assert.equal((await server.api('post', ANALYST, '/users', { name: 'X Y', email: 'x@y.test', password: 'Strong-password-123', level: 0 })).status, 403)
})

test('engineers can update their own cases but not other engineers cases', async () => {
  const engineerCase = await Report.findOne({ assignedTo: (await User.findOne({ email: MALWARE }))._id, status: { $nin: ['Completed', 'Closed'] } })
  assert.equal((await server.api('patch', TROJAN, `/reports/${engineerCase.id}/status`, { status: 'In Progress' })).status, 404)
  assert.equal((await server.api('patch', MALWARE, `/reports/${engineerCase.id}/status`, { status: 'Under Surveillance' })).status, 403)
  const updated = await server.api('patch', MALWARE, `/reports/${engineerCase.id}/status`, { status: 'In Progress', progress: 40 })
  assert.equal(updated.status, 200)
  assert.equal((await server.api('patch', REPORTER, `/reports/${engineerCase.id}/status`, { status: 'Closed' })).status, 403)
  const surveillance = await server.api('patch', ANALYST, `/reports/${engineerCase.id}/status`, { status: 'Under Surveillance' })
  assert.equal(surveillance.status, 200)
})

test('help requests: the colleague accepts and becomes a collaborator', async () => {
  const [malware, trojan] = await Promise.all([MALWARE, TROJAN].map((email) => User.findOne({ email })))
  const report = await Report.findOne({ assignedTo: malware._id, status: { $nin: ['Completed', 'Closed'] } })
  const requested = await server.api('post', MALWARE, `/reports/${report.id}/help-requests`, { targetId: trojan.id, message: 'Need a second pair of eyes' })
  assert.equal(requested.status, 201)
  const requestId = requested.body.data._id
  assert.equal((await server.api('patch', MALWARE, `/help-requests/${requestId}`, { decision: 'accept' })).status, 403)
  assert.equal((await server.api('patch', TROJAN, `/help-requests/${requestId}`, { decision: 'accept' })).status, 200)
  assert.ok((await Report.findById(report._id)).collaborators.some((id) => id.equals(trojan._id)))
})

test('reassignment: reason is validated and approval reassigns away from the requester', async () => {
  const malware = await User.findOne({ email: MALWARE })
  const report = await Report.findOne({ assignedTo: malware._id, status: { $nin: ['Completed', 'Closed'] } })
  const path = `/reports/${report.id}/reassignment-requests`
  assert.equal((await server.api('post', MALWARE, path, { reason: 'too short' })).status, 400)
  const created = await server.api('post', MALWARE, path, { reason: 'Conflict of interest with the affected department' })
  assert.equal(created.status, 201)
  assert.equal((await server.api('patch', MALWARE, `/reassignment-requests/${created.body.data._id}`, { decision: 'approve', note: 'ok' })).status, 403)
  const approved = await server.api('patch', ANALYST, `/reassignment-requests/${created.body.data._id}`, { decision: 'approve', note: 'Approved, moving it' })
  assert.equal(approved.status, 200)
  const moved = await Report.findById(report._id)
  assert.notEqual(String(moved.assignedTo), String(malware._id))
  assert.equal(moved.assignmentHistory.at(-1).by, String((await User.findOne({ email: ANALYST }))._id))
})

test('level 2 can manually reassign and the audit log records the change', async () => {
  const report = await Report.findOne({ assignedTo: { $ne: null }, status: { $nin: ['Completed', 'Closed'] } })
  const target = await User.findOne({ email: NETWORK })
  const changed = await server.api('patch', ANALYST, `/reports/${report.id}/assignment`, { assigneeId: target.id, reason: 'Network expertise needed' })
  assert.equal(changed.status, 200)
  assert.equal(String((await Report.findById(report._id)).assignedTo), String(target._id))
  assert.equal((await server.api('patch', TROJAN, `/reports/${report.id}/assignment`, { assigneeId: target.id })).status, 403)
  const logs = await server.api('get', ANALYST, `/audit-logs?resourceId=${report.id}`)
  assert.ok(logs.body.data.some((entry) => entry.action === 'report.assignment_changed' && entry.before && entry.after))
})

test('analytics returns visibility-scoped aggregates', async () => {
  const summary = await server.api('get', ANALYST, '/analytics/summary')
  assert.equal(summary.body.data.totals.total, await Report.countDocuments())
  const mine = await server.api('get', OTHER_REPORTER, '/analytics/summary')
  assert.equal(mine.body.data.totals.total, await Report.countDocuments({ reporterId: (await User.findOne({ email: OTHER_REPORTER }))._id }))
})
