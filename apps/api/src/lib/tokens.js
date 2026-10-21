import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'

export function createAccessToken(user) {
  return jwt.sign(
    { orgId: user.orgId.toString(), level: user.level },
    process.env.JWT_ACCESS_SECRET,
    { subject: user._id.toString(), expiresIn: process.env.JWT_ACCESS_TTL ?? '15m' },
  )
}

export function createRefreshToken() {
  return randomBytes(48).toString('base64url')
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}
