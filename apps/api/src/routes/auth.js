import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import QRCode from 'qrcode'
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib'
import { z } from 'zod'
import { Organization, PasswordReset, RefreshSession, User } from '../models.js'
import { ApiError, asyncHandler } from '../lib/errors.js'
import { createAccessToken, createRefreshToken, hashToken } from '../lib/tokens.js'
import { decryptMfaSecret, encryptMfaSecret } from '../lib/mfaEncryption.js'
import { deliverEmail } from '../lib/email.js'
import { writeAudit } from '../lib/audit.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128), totpCode: z.string().length(6).optional(), recoveryCode: z.string().min(8).max(32).optional() })
const refreshSchema = z.object({ refreshToken: z.string().min(40).max(128) })

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  level: user.level,
  title: user.title,
  orgId: user.orgId,
  mfaEnabled: user.mfaEnabled,
  ...(user.level === 1 && { specialties: user.specialties, availability: user.availability, activeCaseCount: user.activeCaseCount, maxActiveCases: user.maxActiveCases }),
})

function recoveryCodeMatches(candidate, hashes) {
  const candidateHash = Buffer.from(hashToken(candidate))
  return hashes.findIndex((savedHash) => {
    const saved = Buffer.from(savedHash)
    return saved.length === candidateHash.length && timingSafeEqual(saved, candidateHash)
  })
}

async function issueTokens(user) {
  const refreshToken = createRefreshToken()
  await RefreshSession.create({
    userId: user._id,
    orgId: user.orgId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })
  return { accessToken: createAccessToken(user), refreshToken, expiresIn: 900 }
}

router.post('/login', asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body)
  const user = await User.findOne({ email: input.email.toLowerCase(), isActive: true }).select('+passwordHash +mfaSecretEncrypted +recoveryCodeHashes')
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
  if (user.mfaEnabled) {
    let verified = false
    if (input.totpCode && user.mfaSecretEncrypted) {
      const secret = decryptMfaSecret(user.mfaSecretEncrypted)
      verified = (await verifyTotp({ secret, token: input.totpCode })).valid
    }
    if (!verified && input.recoveryCode) {
      const index = recoveryCodeMatches(input.recoveryCode, user.recoveryCodeHashes ?? [])
      if (index >= 0) {
        user.recoveryCodeHashes.splice(index, 1)
        await user.save()
        verified = true
      }
    }
    if (!verified) throw new ApiError(401, 'MFA_REQUIRED', 'A valid authenticator or recovery code is required')
  }
  const tokens = await issueTokens(user)
  res.json({ data: { ...tokens, user: publicUser(user) }, requestId: req.id })
}))

const demoOnly = (_req, _res, next) => next(process.env.NODE_ENV === 'production' ? new ApiError(404, 'NOT_FOUND', 'Route not found') : undefined)

async function demoUsers() {
  const organization = await Organization.findOne({ slug: process.env.DEMO_ORG_SLUG ?? 'northstar' })
  return organization ? User.find({ orgId: organization._id, isActive: true }).sort({ level: 1, name: 1 }) : []
}

router.get('/demo-accounts', demoOnly, asyncHandler(async (req, res) => {
  const users = await demoUsers()
  res.json({ data: users.map(({ name, email, level, title }) => ({ name, email, level, title })), requestId: req.id })
}))

router.post('/demo-login', demoOnly, asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().trim().email() }).parse(req.body)
  const user = (await demoUsers()).find((candidate) => candidate.email === email.toLowerCase())
  if (!user) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Not a demo account')
  await writeAudit({ orgId: user.orgId, actorId: user._id, action: 'user.demo_login', resourceType: 'User', resourceId: user.id, requestId: req.id })
  res.json({ data: { ...(await issueTokens(user)), user: publicUser(user) }, requestId: req.id })
}))

router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body)
  const oldSession = await RefreshSession.findOne({ tokenHash: hashToken(refreshToken), revokedAt: null, expiresAt: { $gt: new Date() } })
  if (!oldSession) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired')
  const revoked = await RefreshSession.updateOne({ _id: oldSession._id, revokedAt: null }, { $set: { revokedAt: new Date() } })
  if (revoked.modifiedCount !== 1) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token has already been used')
  const user = await User.findOne({ _id: oldSession.userId, orgId: oldSession.orgId, isActive: true })
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Account is unavailable')
  const tokens = await issueTokens(user)
  res.json({ data: tokens, requestId: req.id })
}))

router.post('/logout', asyncHandler(async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body)
  if (parsed.success) await RefreshSession.updateOne({ tokenHash: hashToken(parsed.data.refreshToken), revokedAt: null }, { $set: { revokedAt: new Date() } })
  res.status(204).end()
}))

router.get('/me', authenticate, (req, res) => {
  res.json({ data: publicUser(req.auth.user), requestId: req.id })
})

router.post('/password/forgot', asyncHandler(async (req, res) => {
  const input = z.object({ email: z.string().trim().email().max(254) }).parse(req.body)
  const user = await User.findOne({ email: input.email.toLowerCase(), isActive: true })
  if (user) {
    const rawToken = randomBytes(32).toString('base64url')
    await PasswordReset.create({ userId: user._id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
    const resetUrl = `${process.env.WEB_BASE_URL ?? 'http://localhost:5173'}/?resetToken=${encodeURIComponent(rawToken)}`
    try {
      await deliverEmail({
        to: user.email,
        subject: 'Reset your Sentinel Ops password',
        text: `A password reset was requested. This link expires in 60 minutes: ${resetUrl}`,
        html: `<p>A password reset was requested.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 60 minutes.</p>`,
      })
    } catch (error) {
      console.error({ requestId: req.id, action: 'password_reset_email_failed', error: error.message })
    }
  }
  res.status(202).json({ data: { message: 'If the account exists, password reset instructions have been sent.' }, requestId: req.id })
}))

router.post('/password/reset', asyncHandler(async (req, res) => {
  const input = z.object({ token: z.string().min(32).max(128), password: z.string().min(12).max(128) }).parse(req.body)
  const reset = await PasswordReset.findOne({ tokenHash: hashToken(input.token), usedAt: null, expiresAt: { $gt: new Date() } })
  if (!reset) throw new ApiError(400, 'INVALID_RESET_TOKEN', 'Password reset token is invalid or expired')
  const session = await User.startSession()
  try {
    await session.withTransaction(async () => {
      const claimed = await PasswordReset.updateOne({ _id: reset._id, usedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { session })
      if (claimed.modifiedCount !== 1) throw new ApiError(400, 'INVALID_RESET_TOKEN', 'Password reset token is invalid or expired')
      await User.updateOne({ _id: reset.userId, isActive: true }, { $set: { passwordHash: await bcrypt.hash(input.password, 12) } }, { session })
      await RefreshSession.updateMany({ userId: reset.userId, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session })
    })
  } finally {
    await session.endSession()
  }
  res.json({ data: { message: 'Password reset complete. Sign in with your new password.' }, requestId: req.id })
}))

router.post('/mfa/enroll', authenticate, asyncHandler(async (req, res) => {
  const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body)
  const user = await User.findOne({ _id: req.auth.userId, orgId: req.auth.orgId, isActive: true }).select('+passwordHash +mfaSecretEncrypted')
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect')
  if (user.mfaEnabled) throw new ApiError(409, 'MFA_ALREADY_ENABLED', 'MFA is already enabled')
  const secret = generateSecret()
  user.pendingMfaSecretEncrypted = encryptMfaSecret(secret)
  await user.save()
  const otpauthUrl = generateURI({ issuer: 'Sentinel Ops', label: user.email, secret })
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
  res.json({ data: { secret, otpauthUrl, qrCodeDataUrl }, requestId: req.id })
}))

router.post('/mfa/verify', authenticate, asyncHandler(async (req, res) => {
  const { token } = z.object({ token: z.string().regex(/^\d{6}$/) }).parse(req.body)
  const user = await User.findOne({ _id: req.auth.userId, orgId: req.auth.orgId, isActive: true }).select('+pendingMfaSecretEncrypted +recoveryCodeHashes')
  if (!user?.pendingMfaSecretEncrypted) throw new ApiError(409, 'MFA_ENROLLMENT_REQUIRED', 'Start MFA enrollment before verifying a code')
  const secret = decryptMfaSecret(user.pendingMfaSecretEncrypted)
  if (!(await verifyTotp({ secret, token })).valid) throw new ApiError(400, 'INVALID_MFA_CODE', 'Authenticator code is invalid')
  const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(6).toString('hex').toUpperCase())
  user.mfaSecretEncrypted = user.pendingMfaSecretEncrypted
  user.pendingMfaSecretEncrypted = undefined
  user.recoveryCodeHashes = recoveryCodes.map(hashToken)
  user.mfaEnabled = true
  await user.save()
  await writeAudit({ orgId: req.auth.orgId, actorId: req.auth.userId, action: 'user.mfa_enabled', resourceType: 'User', resourceId: req.auth.userId.toString(), requestId: req.id })
  res.json({ data: { mfaEnabled: true, recoveryCodes }, requestId: req.id })
}))

router.post('/mfa/disable', authenticate, asyncHandler(async (req, res) => {
  const input = z.object({ password: z.string().min(1).max(128), totpCode: z.string().regex(/^\d{6}$/).optional(), recoveryCode: z.string().min(8).max(32).optional() }).parse(req.body)
  const user = await User.findOne({ _id: req.auth.userId, orgId: req.auth.orgId, isActive: true }).select('+passwordHash +mfaSecretEncrypted +recoveryCodeHashes')
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect')
  if (user.mfaEnabled) {
    let verified = false
    if (input.totpCode && user.mfaSecretEncrypted) verified = (await verifyTotp({ secret: decryptMfaSecret(user.mfaSecretEncrypted), token: input.totpCode })).valid
    if (!verified && input.recoveryCode) verified = recoveryCodeMatches(input.recoveryCode, user.recoveryCodeHashes ?? []) >= 0
    if (!verified) throw new ApiError(400, 'INVALID_MFA_CODE', 'A valid authenticator or recovery code is required')
  }
  user.mfaEnabled = false
  user.mfaSecretEncrypted = undefined
  user.pendingMfaSecretEncrypted = undefined
  user.recoveryCodeHashes = []
  await user.save()
  await writeAudit({ orgId: req.auth.orgId, actorId: req.auth.userId, action: 'user.mfa_disabled', resourceType: 'User', resourceId: req.auth.userId.toString(), requestId: req.id })
  res.json({ data: { mfaEnabled: false }, requestId: req.id })
}))

export default router
