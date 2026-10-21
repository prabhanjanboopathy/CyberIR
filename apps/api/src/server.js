import 'dotenv/config'
import http from 'node:http'
import { mkdir } from 'node:fs/promises'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { createApp } from './app.js'
import { User } from './models.js'
import { seedDemoData } from './seedDemo.js'
import { staffRoom, userRoom } from './lib/realtime.js'

const required = ['JWT_ACCESS_SECRET']
const missing = required.filter((key) => !process.env[key])
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
if (process.env.JWT_ACCESS_SECRET.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters')

const mongoUri = process.env.MONGODB_URI ?? ''
const hasConfiguredMongoUri = /^(mongodb|mongodb\+srv):\/\//i.test(mongoUri) && !/[<>]/.test(mongoUri) && !/replace-with/i.test(mongoUri)
let memoryReplicaSet

if (hasConfiguredMongoUri) {
  await mongoose.connect(mongoUri)
  if (process.env.SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production') {
    await seedDemoData({ password: process.env.DEMO_PASSWORD, orgSlug: process.env.DEMO_ORG_SLUG })
  }
} else if (process.env.NODE_ENV !== 'production') {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server')
  const dbPath = process.env.LOCAL_DB_PATH
  if (dbPath) await mkdir(dbPath, { recursive: true })
  memoryReplicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: dbPath ? 'wiredTiger' : undefined },
    instanceOpts: [dbPath ? { dbPath, port: Number(process.env.LOCAL_DB_PORT ?? 27018) } : {}],
  })
  await mongoose.connect(memoryReplicaSet.getUri())
  await seedDemoData({ password: process.env.DEMO_PASSWORD, orgSlug: process.env.DEMO_ORG_SLUG })
  console.warn(dbPath ? `Using embedded MongoDB stored in ${dbPath}` : 'No Atlas URI configured. Using ephemeral development MongoDB; data resets when the API stops.')
} else {
  throw new Error('MONGODB_URI must be configured in production')
}

const app = createApp()
const server = http.createServer(app)
const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((item) => item.trim())
const io = new Server(server, { cors: { origin: origins, credentials: true } })
app.set('io', io)

io.use(async (socket, next) => {
  try {
    const claims = jwt.verify(socket.handshake.auth?.token, process.env.JWT_ACCESS_SECRET)
    const user = await User.findOne({ _id: claims.sub, orgId: claims.orgId, isActive: true }).select('_id orgId level')
    if (!user) return next(new Error('Unauthorized'))
    socket.data.user = user
    next()
  } catch {
    next(new Error('Unauthorized'))
  }
})
io.on('connection', (socket) => {
  const { _id, orgId, level } = socket.data.user
  socket.join(userRoom(_id))
  if (level >= 2) socket.join(staffRoom(orgId))
})

const port = Number(process.env.PORT ?? 4000)
server.listen(port, () => console.log(`CyberIR API listening on http://localhost:${port}`))

async function shutdown() {
  server.close()
  io.close()
  await mongoose.disconnect()
  await memoryReplicaSet?.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
