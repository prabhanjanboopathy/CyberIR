import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const api = join(root, 'apps', 'api')
const port = process.env.PORT ?? '4000'
const url = `http://localhost:${port}`
const run = (command, args) => spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: true }).status === 0

if (!existsSync(join(api, '.env')) && !run('node', ['scripts/setup.mjs'])) process.exit(1)
if ((process.argv.includes('--rebuild') || !existsSync(join(root, 'apps', 'web', 'dist'))) && !run('npm', ['run', 'build'])) process.exit(1)

const server = spawn(process.execPath, ['src/server.js'], {
  cwd: api,
  stdio: 'inherit',
  env: { ...process.env, MONGODB_URI: '', PORT: port, LOCAL_DB_PATH: join(api, 'var', 'db') },
})
server.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))

for (let attempt = 0; attempt < 120; attempt += 1) {
  if (await fetch(`${url}/api/v1/health`).then((response) => response.ok, () => false)) {
    console.log(`\nCyberIR is running at ${url} (press Ctrl+C to stop)`)
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' }).unref()
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
