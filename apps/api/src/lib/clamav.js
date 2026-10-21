import net from 'node:net'

export function scanEvidenceBuffer(buffer) {
  const host = process.env.CLAMAV_HOST
  if (!host) return Promise.resolve('not_scanned')

  return new Promise((resolve) => {
    const port = Number(process.env.CLAMAV_PORT ?? 3310)
    const timeoutMs = Math.max(1000, Number(process.env.CLAMAV_TIMEOUT_MS ?? 15000))
    const socket = net.createConnection({ host, port })
    let response = ''
    let finished = false

    function finish(status) {
      if (finished) return
      finished = true
      socket.destroy()
      resolve(status)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      socket.write(Buffer.from('zINSTREAM\0'))
      for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
        const chunk = buffer.subarray(offset, Math.min(offset + 64 * 1024, buffer.length))
        const length = Buffer.alloc(4)
        length.writeUInt32BE(chunk.length)
        socket.write(length)
        socket.write(chunk)
      }
      socket.write(Buffer.alloc(4))
    })
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (!response.includes('\0')) return
      if (response.includes('FOUND')) finish('infected')
      else if (response.includes('OK')) finish('clean')
      else finish('scan_failed')
    })
    socket.once('timeout', () => finish('scan_failed'))
    socket.once('error', () => finish('scan_failed'))
  })
}