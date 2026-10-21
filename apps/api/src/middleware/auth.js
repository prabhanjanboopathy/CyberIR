import jwt from 'jsonwebtoken'
import { User } from '../models.js'
import { ApiError, asyncHandler } from '../lib/errors.js'

export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid access token is required')

  let claims
  try {
    claims = jwt.verify(token, process.env.JWT_ACCESS_SECRET)
  } catch {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Access token is invalid or expired')
  }

  const user = await User.findOne({ _id: claims.sub, orgId: claims.orgId, isActive: true })
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Account is unavailable')
  req.auth = { userId: user._id, orgId: user.orgId, level: user.level, user }
  next()
})

export function requireLevel(min) {
  return (req, _res, next) => {
    if (!req.auth || req.auth.level < min) return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action'))
    next()
  }
}
