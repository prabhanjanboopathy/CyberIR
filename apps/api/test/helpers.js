import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'

process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-at-least-32-characters-long'
process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
process.env.EVIDENCE_LOCAL_DIR = await mkdtemp(join(tmpdir(), 'sentinel-evidence-'))
process.env.DEV_MAIL_DIR = await mkdtemp(join(tmpdir(), 'sentinel-mail-'))

export const DEMO_PASSWORD = 'Demo-password-123!'

const { MongoMemoryReplSet } = await import('mongodb-memory-server')
const mongoose = (await import('mongoose')).default
const { createApp } = await import('../src/app.js')
const { seedDemoData } = await import('../src/seedDemo.js')
const { User } = await import('../src/models.js')
const { createAccessToken } = await import('../src/lib/tokens.js')

export async function startTestServer({ seed = true } = {}) {
  const replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  await mongoose.connect(replicaSet.getUri())
  if (seed) await seedDemoData({ password: DEMO_PASSWORD, orgSlug: 'northstar' })
  const app = createApp()

  const tokens = new Map()
  const as = async (email) => {
    if (!tokens.has(email)) tokens.set(email, createAccessToken(await User.findOne({ email })))
    return { Authorization: `Bearer ${tokens.get(email)}` }
  }
  const api = async (method, email, path, body) => {
    const req = request(app)[method](`/api/v1${path}`).set(await as(email))
    return body ? req.send(body) : req
  }

  const stop = async () => {
    await mongoose.disconnect()
    await replicaSet.stop()
    await Promise.all([process.env.EVIDENCE_LOCAL_DIR, process.env.DEV_MAIL_DIR].map((dir) => rm(dir, { recursive: true, force: true })))
  }
  return { app, api, as, stop }
}
