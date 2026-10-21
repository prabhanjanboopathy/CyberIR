const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000/api/v1'

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  const text = await response.text()
  let payload = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { raw: text }
  }
  return { response, payload }
}

const health = await requestJson('/health')
if (health.response.status !== 200) {
  console.error('Health check did not return 200')
  process.exit(1)
}

const requestId = health.response.headers.get('x-request-id')
const requiredHeaders = [
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'SAMEORIGIN'],
  ['x-dns-prefetch-control', 'off'],
]

if (!requestId) {
  console.error('Health endpoint did not include x-request-id header')
  process.exit(1)
}

for (const [header, expected] of requiredHeaders) {
  const value = health.response.headers.get(header)
  if (value !== expected) {
    console.error(`Header ${header} mismatch: expected ${expected}, got ${value}`)
    process.exit(1)
  }
}

const protectedResponse = await requestJson('/reports')
if (protectedResponse.response.status !== 401) {
  console.error(`Protected route should reject unauthenticated requests with 401, received ${protectedResponse.response.status}`)
  process.exit(1)
}

console.log('Compliance check passed: request metadata and security headers are present, and protected routes reject anonymous access.')
