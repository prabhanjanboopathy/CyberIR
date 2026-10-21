import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import authRoutes from './routes/auth.js'
import reportRoutes from './routes/reports.js'
import requestRoutes from './routes/requests.js'
import userRoutes from './routes/users.js'
import auditLogRoutes from './routes/auditLogs.js'
import analyticsRoutes from './routes/analytics.js'
import evidenceRoutes from './routes/evidence.js'
import mobileRoutes from './routes/mobile.js'
import { errorHandler } from './lib/errors.js'

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url))

export function createApp() {
  const app = express()
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((item) => item.trim())
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id']?.toString().slice(0, 100) || crypto.randomUUID()
    res.setHeader('X-Request-Id', req.id)
    next()
  })
  app.use(helmet())
  app.use(cors((req, callback) => {
    const origin = req.headers.origin
    const allowed = !origin || origins.includes(origin) || origin === `${req.protocol}://${req.get('host')}`
    callback(allowed ? null : new Error('Origin is not allowed by CORS'), { credentials: true, origin: allowed })
  }))
  app.use(express.json({ limit: '64kb' }))
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', service: 'sentinel-api' }))
  const credentialLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false })
  app.use(['/api/v1/auth/login', '/api/v1/auth/password'], credentialLimiter)
  app.use('/api/v1/auth', authRoutes)
  app.use('/api/v1/reports', reportRoutes)
  app.use('/api/v1/users', userRoutes)
  app.use('/api/v1/audit-logs', auditLogRoutes)
  app.use('/api/v1/analytics', analyticsRoutes)
  app.use('/api/v1/mobile', mobileRoutes)
  app.use('/api/v1', evidenceRoutes)
  app.use('/api/v1', requestRoutes)
  app.use('/api', (_req, _res, next) => next(Object.assign(new Error('Route not found'), { status: 404, code: 'NOT_FOUND' })))
  if (existsSync(webDist)) {
    app.use(express.static(webDist))
    app.get('/{*path}', (_req, res) => res.sendFile(join(webDist, 'index.html')))
  }
  app.use((_req, _res, next) => next(Object.assign(new Error('Route not found'), { status: 404, code: 'NOT_FOUND' })))
  app.use(errorHandler)
  return app
}
