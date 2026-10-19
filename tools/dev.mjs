// `yarn dev`: Vite dev server for the UI + the Electron shell.
// Electron's dev service controller starts the backend (as a plain Node process
// in .dev-data/), so no Windows service is needed during development.
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const yarn = join(root, '.yarn', 'releases', 'yarn-4.18.1.cjs')
const UI_URL = 'http://localhost:5173'

// Some shells (VS Code among them) export ELECTRON_RUN_AS_NODE, which turns electron.exe into plain Node.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const run = (args, opts = {}) => spawn(process.execPath, [yarn, ...args], { cwd: root, stdio: 'inherit', env, ...opts })

console.log('Building the Electron main/preload bundles…')
const built = spawnSync(process.execPath, [yarn, 'workspace', '@theama/desktop', 'run', 'build'], { cwd: root, stdio: 'inherit', env })
if (built.status !== 0) process.exit(built.status ?? 1)

const vite = run(['workspace', '@theama/ui', 'run', 'dev'])

async function waitForVite() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(UI_URL)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('Vite dev server did not start')
}

function shutdown(code) {
  vite.kill()
  process.exit(code)
}

try {
  await waitForVite()
} catch (err) {
  console.error(String(err))
  shutdown(1)
}

const electronPath = createRequire(join(root, 'apps', 'desktop', 'package.json'))('electron')
const electron = spawn(electronPath, ['.'], {
  cwd: join(root, 'apps', 'desktop'),
  stdio: 'inherit',
  env: { ...env, THEAMA_DEV_URL: UI_URL },
})
electron.on('exit', (code) => shutdown(code ?? 0))
process.on('SIGINT', () => {
  electron.kill()
  shutdown(0)
})
