export const userRoom = (userId) => `user:${userId}`
export const staffRoom = (orgId) => `staff:${orgId}`

export function emitTo(req, { users = [], staff = false }, event, payload) {
  const io = req.app.get('io')
  if (!io) return
  const rooms = users.filter(Boolean).map((id) => userRoom(id))
  if (staff) rooms.push(staffRoom(req.auth.orgId))
  if (rooms.length) io.to(rooms).emit(event, payload)
}
