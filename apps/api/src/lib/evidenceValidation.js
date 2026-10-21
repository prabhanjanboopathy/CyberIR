import { extname } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import { ApiError } from './errors.js'

const contentTypes = {
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.eml': 'message/rfc822',
  '.pcap': 'application/vnd.tcpdump.pcap',
  '.pcapng': 'application/vnd.tcpdump.pcapng',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
}

function sanitizeName(name) {
  const baseName = name.replaceAll('\\', '/').split('/').at(-1) ?? 'evidence'
  return baseName.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180) || 'evidence'
}

function hasPcapSignature(buffer) {
  const magic = buffer.subarray(0, 4).toString('hex')
  return ['d4c3b2a1', 'a1b2c3d4', '4d3cb2a1', 'a1b23c4d'].includes(magic)
}

export async function validateEvidenceFile(file) {
  if (!file?.buffer?.length) throw new ApiError(400, 'VALIDATION_ERROR', 'An evidence file is required')
  if (file.buffer.length > 25 * 1024 * 1024) throw new ApiError(413, 'FILE_TOO_LARGE', 'Evidence files are limited to 25 MB')

  const originalName = sanitizeName(file.originalname ?? '')
  const extension = extname(originalName).toLowerCase()
  const contentType = contentTypes[extension]
  if (!contentType) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Allowed evidence: text, CSV, JSON, EML, PCAP, PNG, JPEG, or PDF')

  if (['.txt', '.log', '.csv', '.json', '.eml'].includes(extension)) {
    if (file.buffer.includes(0)) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'File content does not match a text evidence type')
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer)
    } catch {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Text evidence must be valid UTF-8')
    }
    if (extension === '.json') {
      try { JSON.parse(text) } catch { throw new ApiError(400, 'VALIDATION_ERROR', 'JSON evidence is not valid JSON') }
    }
  } else if (extension === '.pcap') {
    if (!hasPcapSignature(file.buffer)) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'File content does not match a PCAP capture')
  } else if (extension === '.pcapng') {
    if (file.buffer.subarray(0, 4).toString('hex') !== '0a0d0d0a') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'File content does not match a PCAPNG capture')
  } else {
    const detected = await fileTypeFromBuffer(file.buffer)
    if (detected?.mime !== contentType) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'File signature does not match its extension')
  }

  return { originalName, extension, contentType }
}