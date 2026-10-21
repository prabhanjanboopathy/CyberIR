import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(join(fileURLToPath(import.meta.url), '..', '..'))
const apiDir = join(root, 'apps', 'api')
const envPath = join(apiDir, '.env')
const examplePath = join(apiDir, '.env.example')
const forceProduction = process.argv.includes('--production')

function parseEnv(source) {
  const values = {}
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    values[match[1]] = match[2].trim()
  }
  return values
}

const source = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(examplePath, 'utf8')
const env = parseEnv(source)
const errors = []

const requiredDev = ['JWT_ACCESS_SECRET', 'DEMO_PASSWORD', 'MFA_ENCRYPTION_KEY']
const requiredProd = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'MFA_ENCRYPTION_KEY', 'CORS_ORIGINS', 'WEB_BASE_URL', 'S3_BUCKET', 'MAIL_HOST', 'CLAMAV_HOST']
const targetKeys = forceProduction ? requiredProd : requiredDev

for (const key of targetKeys) {
  const value = env[key] ?? ''
  if (!value || /replace-with|<|>/i.test(value)) {
    errors.push(`${key} is missing or still uses a placeholder value`)
  }
}

if (forceProduction) {
  if (!/^(mongodb|mongodb\+srv):\/\//i.test(env.MONGODB_URI ?? '')) {
    errors.push('MONGODB_URI must be a valid MongoDB connection string in production mode')
  } else {
    const mongoHost = new URL(env.MONGODB_URI).hostname.toLowerCase()
    if (['localhost', '127.0.0.1', '::1'].includes(mongoHost)) {
      errors.push('MONGODB_URI must not point to a loopback address in production mode')
    }
  }
  if ((env.PORT ?? '4000') && Number(env.PORT) <= 0) {
    errors.push('PORT must be a positive integer in production mode')
  }
}

if ((env.JWT_ACCESS_SECRET ?? '').length < 32) {
  errors.push('JWT_ACCESS_SECRET must be at least 32 characters long')
}

if ((env.DEMO_PASSWORD ?? '').length < 12 && !forceProduction) {
  errors.push('DEMO_PASSWORD should be at least 12 characters long for local development')
}

const mfaValue = env.MFA_ENCRYPTION_KEY ?? ''
try {
  const decoded = Buffer.from(mfaValue, 'base64')
  if (decoded.length !== 32) errors.push('MFA_ENCRYPTION_KEY must decode to exactly 32 bytes')
} catch {
  errors.push('MFA_ENCRYPTION_KEY is not valid base64')
}

console.log('Production configuration check')
console.log(`Mode: ${forceProduction ? 'production' : 'local-dev'}`)
console.log(`JWT_ACCESS_SECRET: ${((env.JWT_ACCESS_SECRET ?? '').length >= 32) ? 'ready' : 'missing or too short'}`)
console.log(`MFA_ENCRYPTION_KEY: ${((Buffer.from(mfaValue, 'base64').length ?? 0) === 32) ? 'ready' : 'needs attention'}`)
console.log(`MONGODB_URI: ${env.MONGODB_URI ? 'set' : 'not configured'}`)
console.log(`CORS_ORIGINS: ${env.CORS_ORIGINS ?? 'not set'}`)
console.log(`WEB_BASE_URL: ${env.WEB_BASE_URL ?? 'not set'}`)
console.log(`S3_BUCKET: ${env.S3_BUCKET ? 'set' : 'not set'}`)
console.log(`MAIL_HOST: ${env.MAIL_HOST ? 'set' : 'not set'}`)
console.log(`CLAMAV_HOST: ${env.CLAMAV_HOST ? 'set' : 'not set'}`)

if (errors.length > 0) {
  console.error('\nConfiguration issues detected:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('\nEnvironment check passed.')
