import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import request from 'supertest'
import { generate } from 'otplib'
import { DEMO_PASSWORD, startTestServer } from './helpers.js'

const { Report, User } = await import('../src/models.js')

const REPORTER = 'reporter1@northstar.test'
const ENGINEER = 'engineer.malware@northstar.test'
const evidenceBuffer = Buffer.from('sample incident log\nsource=endpoint-17\n')

let server
let password = DEMO_PASSWORD
before(async () => { server = await startTestServer() })
after(() => server.stop())

const login = (body) => request(server.app).post('/api/v1/auth/login').send({ email: ENGINEER, password, ...body })

test('login returns the user level and title, and rejects bad passwords', async () => {
  const ok = await login()
  assert.equal(ok.status, 200)
  assert.equal(ok.body.data.user.level, 1)
  assert.equal(ok.body.data.user.title, 'Cybersecurity Engineer')
  assert.equal((await login({ password: 'wrong-password-1' })).status, 401)
  await User.updateOne({ email: 'reporter2@northstar.test' }, { isActive: false })
  const inactive = await request(server.app).post('/api/v1/auth/login').send({ email: 'reporter2@northstar.test', password })
  assert.equal(inactive.status, 401)
})

test('quick sign-in lists active demo accounts and signs in without a password', async () => {
  const list = await request(server.app).get('/api/v1/auth/demo-accounts').expect(200)
  const emails = list.body.data.map((account) => account.email)
  assert.equal(emails.length, 9)
  assert.ok(emails.includes(ENGINEER) && !emails.includes('reporter2@northstar.test'))
  assert.ok(!JSON.stringify(list.body).includes(password))
  assert.deepEqual(list.body.data.map((account) => account.level), list.body.data.map((account) => account.level).sort())

  const session = await request(server.app).post('/api/v1/auth/demo-login').send({ email: ENGINEER }).expect(200)
  const me = await request(server.app).get('/api/v1/auth/me').set('Authorization', `Bearer ${session.body.data.accessToken}`).expect(200)
  assert.equal(me.body.data.email, ENGINEER)
  assert.equal(me.body.data.level, 1)

  await request(server.app).post('/api/v1/auth/demo-login').send({ email: 'reporter2@northstar.test' }).expect(401)
  await request(server.app).post('/api/v1/auth/demo-login').send({ email: 'nobody@example.com' }).expect(401)
})

test('quick sign-in is unavailable in production', async () => {
  process.env.NODE_ENV = 'production'
  try {
    await request(server.app).get('/api/v1/auth/demo-accounts').expect(404)
    await request(server.app).post('/api/v1/auth/demo-login').send({ email: ENGINEER }).expect(404)
  } finally {
    process.env.NODE_ENV = 'test'
  }
})

test('uploads evidence to an accessible report and keeps a valid custody chain', async () => {
  const report = await Report.findOne({ reporterId: (await User.findOne({ email: REPORTER }))._id })
  const upload = (headers) => request(server.app).post(`/api/v1/reports/${report.id}/evidence`).set(headers)
  const uploaded = await upload(await server.as(REPORTER)).field('classification', 'restricted').attach('file', evidenceBuffer, { filename: 'endpoint.log', contentType: 'text/plain' })
  assert.equal(uploaded.status, 201)
  assert.equal(uploaded.body.data.sha256, createHash('sha256').update(evidenceBuffer).digest('hex'))

  const stranger = await upload(await server.as('reporter3@northstar.test')).attach('file', evidenceBuffer, { filename: 'endpoint.log', contentType: 'text/plain' })
  assert.equal(stranger.status, 404)
  const exe = await upload(await server.as(REPORTER)).attach('file', Buffer.from('not an executable'), { filename: 'tool.exe', contentType: 'application/octet-stream' })
  assert.equal(exe.status, 415)

  const evidenceId = uploaded.body.data.id
  assert.equal((await server.api('get', 'analyst@northstar.test', `/evidence/${evidenceId}/download`)).text, evidenceBuffer.toString())
  const custody = await server.api('get', REPORTER, `/evidence/${evidenceId}/custody`)
  assert.equal(custody.body.integrityValid, true)
  assert.deepEqual(custody.body.data.map((event) => event.action), ['uploaded', 'downloaded'])
  assert.equal((await server.api('post', REPORTER, `/evidence/${evidenceId}/custody-events`, { action: 'verified', reason: 'Looks fine to me' })).status, 403)
})

test('password reset writes a local email, changes the password, and consumes its token once', async () => {
  await request(server.app).post('/api/v1/auth/password/forgot').send({ email: ENGINEER }).expect(202)
  const [file] = await readdir(process.env.DEV_MAIL_DIR)
  const message = JSON.parse(await readFile(join(process.env.DEV_MAIL_DIR, file), 'utf8'))
  const token = message.text.match(/resetToken=([A-Za-z0-9_-]+)/)?.[1]
  assert.ok(token)

  const reset = (value) => request(server.app).post('/api/v1/auth/password/reset').send({ token, password: value })
  assert.equal((await reset('Replacement-password-456!')).status, 200)
  assert.equal((await reset('Another-password-789!')).status, 400)
  assert.equal((await login()).status, 401)
  password = 'Replacement-password-456!'
  assert.equal((await login()).status, 200)
})

test('MFA enrollment enforces TOTP and single-use recovery codes', async () => {
  const headers = await server.as(ENGINEER)
  const post = (path, body) => request(server.app).post(`/api/v1/auth${path}`).set(headers).send(body)
  const enrollment = await post('/mfa/enroll', { password }).expect(200)
  const { secret } = enrollment.body.data
  const verified = await post('/mfa/verify', { token: await generate({ secret }) }).expect(200)
  assert.equal(verified.body.data.recoveryCodes.length, 10)

  const challenge = await login()
  assert.equal(challenge.status, 401)
  assert.equal(challenge.body.error.code, 'MFA_REQUIRED')
  assert.equal((await login({ totpCode: await generate({ secret }) })).status, 200)
  const recoveryCode = verified.body.data.recoveryCodes[0]
  assert.equal((await login({ recoveryCode })).status, 200)
  assert.equal((await login({ recoveryCode })).status, 401)
  await post('/mfa/disable', { password, totpCode: await generate({ secret }) }).expect(200)
})

test('mobile push registration stores the push token and preference', async () => {
  const response = await server.api('post', ENGINEER, '/mobile/push-token', { pushToken: 'ExponentPushToken[abc123]', enabled: true })
  assert.equal(response.status, 200)
  const user = await User.findById(response.body.data.userId)
  assert.equal(user.pushToken, 'ExponentPushToken[abc123]')
  assert.equal(user.pushEnabled, true)
})
