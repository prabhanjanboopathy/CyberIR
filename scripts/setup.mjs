import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiDir = join(root, 'apps', 'api')
const envPath = join(apiDir, '.env')
const examplePath = join(apiDir, '.env.example')
const checkOnly = process.argv.includes('--check')
const productionCheck = process.argv.includes('--production')

function readValue(source, key) {
  return source.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
}

function setValue(source, key, value) {
  const line = new RegExp(`^${key}=.*$`, 'm')
  return line.test(source) ? source.replace(line, `${key}=${value}`) : `${source.trimEnd()}\n${key}=${value}\n`
}

function hasPlaceholder(value) {
  return !value || /<|>|replace-with/i.test(value)
}

if (!existsSync(examplePath)) throw new Error('Missing apps/api/.env.example')
if (checkOnly && !existsSync(envPath)) {
  console.error('API config is missing. Run `npm run setup` first.')
  process.exit(1)
}

let config = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(examplePath, 'utf8')
if (!checkOnly) {
  if (hasPlaceholder(readValue(config, 'JWT_ACCESS_SECRET'))) {
    config = setValue(config, 'JWT_ACCESS_SECRET', randomBytes(48).toString('base64url'))
  }
  if (hasPlaceholder(readValue(config, 'DEMO_PASSWORD')) || readValue(config, 'DEMO_PASSWORD').length < 12) {
    config = setValue(config, 'DEMO_PASSWORD', randomBytes(18).toString('base64url'))
  }
  if (hasPlaceholder(readValue(config, 'MFA_ENCRYPTION_KEY'))) {
    config = setValue(config, 'MFA_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
  }
  if (hasPlaceholder(readValue(config, 'MONGODB_URI'))) {
    config = setValue(config, 'MONGODB_URI', 'mongodb://127.0.0.1:27017/sentinel?directConnection=true')
  }
  writeFileSync(envPath, config, { encoding: 'utf8', mode: 0o600 })
  console.log('Created/updated apps/api/.env. Generated secrets stay in that local, git-ignored file.')
}

const mongoUri = readValue(config, 'MONGODB_URI')
const secret = readValue(config, 'JWT_ACCESS_SECRET')
const demoPassword = readValue(config, 'DEMO_PASSWORD')
const uriReady = /^(mongodb|mongodb\+srv):\/\//i.test(mongoUri) && !hasPlaceholder(mongoUri)
const secretReady = secret.length >= 32 && !hasPlaceholder(secret)
const passwordReady = demoPassword.length >= 12 && !hasPlaceholder(demoPassword)
const mfaKey = Buffer.from(readValue(config, 'MFA_ENCRYPTION_KEY'), 'base64')
const mfaKeyReady = mfaKey.length === 32

console.log(`JWT secret: ${secretReady ? 'ready' : 'needs attention'}`)
console.log(`Demo password: ${passwordReady ? 'ready (view it in apps/api/.env)' : 'needs attention'}`)
console.log(`MFA encryption key: ${mfaKeyReady ? 'ready' : 'needs attention'}`)
console.log(`MongoDB URI: ${uriReady ? 'configured' : 'not configured'}`)

if (checkOnly && ((!uriReady && productionCheck) || !secretReady || !passwordReady || !mfaKeyReady)) process.exitCode = 1
if (uriReady && secretReady && passwordReady) console.log('API configuration is ready. Start local Mongo with `npm run db:up`, then run `npm run dev`.')
else if (secretReady && passwordReady) console.log('Local API configuration is ready. Configure MONGODB_URI before starting the API.')
