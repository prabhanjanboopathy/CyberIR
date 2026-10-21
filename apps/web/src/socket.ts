import { io, type Socket } from 'socket.io-client'
import { api, getAccessToken } from './api'
import { apiBaseUrl } from './config'

let socket: Socket | null = null

export function openSocket() {
  if (socket) return
  socket = io(new URL(apiBaseUrl, window.location.origin).origin, { auth: (done) => done({ token: getAccessToken() }) })
  socket.on('connect_error', () => { api.me().catch(() => undefined) })
}

export function closeSocket() {
  socket?.close()
  socket = null
}

export function onLive(handler: (event: string, payload: unknown) => void) {
  socket?.onAny(handler)
  return () => { socket?.offAny(handler) }
}
