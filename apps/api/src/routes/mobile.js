import { Router } from 'express'
import { Expo } from 'expo-server-sdk'
import { z } from 'zod'
import { User } from '../models.js'
import { ApiError, asyncHandler } from '../lib/errors.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
const expo = new Expo()

router.use(authenticate)

router.get('/status', asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.auth.userId, orgId: req.auth.orgId }).select('pushToken pushEnabled').lean()
  res.json({
    data: {
      pushEnabled: Boolean(user?.pushEnabled),
      pushToken: user?.pushToken ?? null,
    },
    requestId: req.id,
  })
}))

router.post('/push-token', asyncHandler(async (req, res) => {
  const input = z.object({
    pushToken: z.string().trim().min(3).max(300),
    enabled: z.boolean().default(true),
  }).strict().parse(req.body)

  if (!Expo.isExpoPushToken(input.pushToken)) {
    throw new ApiError(400, 'INVALID_PUSH_TOKEN', 'Push token must be a valid Expo push token for this device.')
  }

  const user = await User.findOneAndUpdate(
    { _id: req.auth.userId, orgId: req.auth.orgId },
    { $set: { pushToken: input.pushToken, pushEnabled: input.enabled } },
    { new: true }
  ).select('_id pushToken pushEnabled')

  res.json({
    data: {
      userId: String(user._id),
      pushToken: user.pushToken,
      pushEnabled: Boolean(user.pushEnabled),
    },
    requestId: req.id,
  })
}))

router.post('/send-test', asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.auth.userId, orgId: req.auth.orgId }).select('pushToken pushEnabled name')
  if (!user || !user.pushEnabled || !user.pushToken) {
    throw new ApiError(400, 'PUSH_NOT_CONFIGURED', 'Register a mobile push token before sending a test notification.')
  }

  const notifications = [{
    to: user.pushToken,
    sound: 'default',
    title: 'Sentinel Ops',
    body: `${user.name}, a new incident requires your attention.`,
    data: { screen: 'incidents' },
  }]

  const chunks = expo.chunkPushNotifications(notifications)
  const tickets = []

  for (const chunk of chunks) {
    const ticketChunk = await expo.sendPushNotificationsAsync(chunk)
    tickets.push(...ticketChunk)
  }

  res.json({
    data: {
      ok: true,
      sent: tickets.length,
      pushToken: user.pushToken,
    },
    requestId: req.id,
  })
}))

export default router
