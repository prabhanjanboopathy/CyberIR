import { app, BrowserWindow, shell } from 'electron'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const api = join(root, 'apps', 'api')
const port = process.env.PORT ?? '4000'
const url = `http://localhost:${port}`
const run = (command, args, env = {}) => spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...env } })

if (!app.requestSingleInstanceLock()) app.quit()

async function startServer() {
  if (!existsSync(join(api, '.env'))) run(`"${process.execPath}"`, ['scripts/setup.mjs'], { ELECTRON_RUN_AS_NODE: '1' })
  if (!existsSync(join(root, 'apps', 'web', 'dist'))) run('npm', ['run', 'build'])
  process.chdir(api)
  Object.assign(process.env, { MONGODB_URI: '', PORT: port, LOCAL_DB_PATH: join(app.getPath('userData'), 'db') })
  await import('../apps/api/src/server.js')
  while (!(await fetch(`${url}/api/v1/health`).then((response) => response.ok, () => false))) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

app.whenReady().then(async () => {
  await startServer()
  const window = new BrowserWindow({ width: 1280, height: 840, title: 'Sentinel Ops', autoHideMenuBar: true })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target)
    return { action: 'deny' }
  })
  await window.loadURL(url)
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => process.emit('SIGINT'))
