import { createInterface } from 'node:readline/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, 'apps', 'api', '.env')
const examplePath = join(root, 'apps', 'api', '.env.example')

if (!existsSync(envPath)) {
  console.log('No apps/api/.env yet; creating one with generated secrets first…')
  if (spawnSync('node', ['scripts/setup.mjs'], { cwd: root, stdio: 'inherit', shell: true }).status !== 0) process.exit(1)
}

console.log(`
Connect CyberIR to MongoDB Atlas
--------------------------------------
1. Sign in at https://cloud.mongodb.com and create a free (M0) cluster if you don't have one.
2. Under Database Access, create a database user with a password (Atlas > Security > Database Access).
3. Under Network Access, add your current IP address (or 0.0.0.0/0 for quick local testing only).
4. Click "Connect" on your cluster > "Drivers" and copy the connection string
   (mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority).

Paste it below. It is written only to your local, git-ignored apps/api/.env file and is
never sent anywhere else or shown again in this terminal's scrollback after the next prompt.
`)

const rl = createInterface({ input: process.stdin, output: process.stdout })
const raw = (await rl.question('Atlas connection string: ')).trim()
rl.close()

if (!/^mongodb(\+srv)?:\/\//i.test(raw)) {
  console.error('That does not look like a MongoDB connection string (expected mongodb:// or mongodb+srv://).')
  process.exit(1)
}

let uri
try {
  uri = new URL(raw)
} catch {
  console.error('Could not parse the connection string.')
  process.exit(1)
}
if (!uri.pathname || uri.pathname === '/') uri.pathname = '/sentinel'
if (!uri.searchParams.has('retryWrites')) uri.searchParams.set('retryWrites', 'true')
if (!uri.searchParams.has('w')) uri.searchParams.set('w', 'majority')
const finalUri = uri.toString()

let config = readFileSync(existsSync(envPath) ? envPath : examplePath, 'utf8')
config = /^MONGODB_URI=.*$/m.test(config)
  ? config.replace(/^MONGODB_URI=.*$/m, `MONGODB_URI=${finalUri}`)
  : `${config.trimEnd()}\nMONGODB_URI=${finalUri}\n`
writeFileSync(envPath, config, { encoding: 'utf8', mode: 0o600 })
console.log('Saved MONGODB_URI to apps/api/.env.')

console.log('\nValidating the connection (this calls your cluster, no further prompts)…')
const check = spawnSync('node', ['scripts/db-check.mjs'], { cwd: root, stdio: 'inherit', shell: true })
if (check.status !== 0) {
  console.error('\nConnection check failed. Common causes: wrong password, the database user needs "readWrite" on this database, or your IP is not allow-listed under Network Access.')
  process.exit(1)
}

console.log('\nAtlas is connected. Next: run `npm run seed:demo` once, then `npm run dev` (or `npm run start` / `npm run desktop`).')
