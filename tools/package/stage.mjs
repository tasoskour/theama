// Assembles everything the installer ships into build/stage, from already-built pieces:
//
//   build/stage/app/                 what Electron runs (main + preload bundles and a minimal package.json)
//   build/stage/resources/           copied next to the app as "resources/" by the installer:
//     ui/                            the built interface
//     server/server.cjs              the backend bundle, plus the one native module it needs
//     server/node_modules/better-sqlite3/
//     node/node.exe                  the Node.js that runs the backend (the service must not depend on the user's Node)
//     nssm/nssm.exe, service-admin.ps1
//     ffprobe/ffprobe.exe + licence
//     icon.ico, THIRD-PARTY-NOTICES.txt, LICENSE-*.txt
//
//   yarn package:stage        (yarn dist runs this for you)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const stage = join(root, 'build', 'stage')
const app = join(stage, 'app')
const res = join(stage, 'resources')

function need(path, how) {
  if (!existsSync(path)) {
    console.error(`Missing ${path}\n  ${how}`)
    process.exit(1)
  }
  return path
}

const desktop = JSON.parse(readFileSync(join(root, 'apps', 'desktop', 'package.json'), 'utf8'))
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

rmSync(stage, { recursive: true, force: true })
// Earlier installers and the unpacked app are build output only; keeping them piles up over a GB per release.
rmSync(join(root, 'build', 'installer'), { recursive: true, force: true })
for (const d of [app, join(app, 'out'), res]) mkdirSync(d, { recursive: true })

// --- the app Electron runs ---------------------------------------------------------------------------------------
for (const f of ['main.cjs', 'preload.cjs', 'next-notification.cjs']) {
  cpSync(need(join(root, 'apps', 'desktop', 'out', f), 'Run "yarn build" first.'), join(app, 'out', f))
}
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'theama',
      productName: 'Theama',
      version: desktop.version,
      description: rootPkg.description,
      author: 'Theama',
      main: 'out/main.cjs',
      // Everything is bundled into main.cjs / preload.cjs, so the packaged app has no dependencies to install.
    },
    null,
    2,
  ),
)

// --- resources ------------------------------------------------------------------------------------------------------
cpSync(need(join(root, 'apps', 'ui', 'dist'), 'Run "yarn build" first.'), join(res, 'ui'), { recursive: true })

mkdirSync(join(res, 'server'), { recursive: true })
cpSync(need(join(root, 'apps', 'server', 'dist', 'server.cjs'), 'Run "yarn build" first.'), join(res, 'server', 'server.cjs'))
cpSync(need(join(root, 'apps', 'server', 'dist', 'background-worker.cjs'), 'Run "yarn build" first.'), join(res, 'server', 'background-worker.cjs'))
// better-sqlite3 is the one thing the bundle loads from disk: its JavaScript and the Windows x64 prebuilt binary.
const sqlite = join(res, 'server', 'node_modules', 'better-sqlite3')
const sqliteSrc = need(join(root, 'node_modules', 'better-sqlite3'), 'Run "yarn install".')
mkdirSync(join(sqlite, 'prebuilds'), { recursive: true })
cpSync(join(sqliteSrc, 'package.json'), join(sqlite, 'package.json'))
cpSync(join(sqliteSrc, 'LICENSE'), join(sqlite, 'LICENSE'))
cpSync(join(sqliteSrc, 'lib'), join(sqlite, 'lib'), { recursive: true })
cpSync(need(join(sqliteSrc, 'prebuilds', 'win32-x64.node'), 'better-sqlite3 has no win32-x64 binary.'), join(sqlite, 'prebuilds', 'win32-x64.node'))

// The Node.js that runs the service: the one this build ran with, so what was tested is what ships.
mkdirSync(join(res, 'node'), { recursive: true })
cpSync(process.execPath, join(res, 'node', 'node.exe'))
writeFileSync(join(res, 'node', 'VERSION.txt'), `${process.version}\n`)

mkdirSync(join(res, 'nssm'), { recursive: true })
cpSync(need(join(root, 'tools', 'nssm', 'bin', 'nssm.exe'), 'Run "yarn nssm:fetch".'), join(res, 'nssm', 'nssm.exe'))
cpSync(join(root, 'tools', 'nssm', 'service-admin.ps1'), join(res, 'nssm', 'service-admin.ps1'))
cpSync(join(root, 'tools', 'nssm', 'installer-helper.ps1'), join(res, 'nssm', 'installer-helper.ps1'))

mkdirSync(join(res, 'ffprobe'), { recursive: true })
cpSync(need(join(root, 'tools', 'ffprobe', 'bin', 'ffprobe.exe'), 'Run "yarn ffprobe:fetch".'), join(res, 'ffprobe', 'ffprobe.exe'))
for (const f of ['LICENSE-ffmpeg.txt', 'README-ffmpeg.txt']) {
  const p = join(root, 'tools', 'ffprobe', 'bin', f)
  if (existsSync(p)) cpSync(p, join(res, 'ffprobe', f))
  else console.warn(`  note: ${f} is not present; run "yarn ffprobe:fetch --force" once to include FFmpeg's licence text`)
}

cpSync(need(join(root, 'packages', 'brand', 'assets', 'theama.ico'), 'Run "yarn icons".'), join(res, 'icon.ico'))
for (const f of ['tray-16.png', 'tray-32.png']) cpSync(need(join(root, 'packages', 'brand', 'assets', f), 'Run "yarn icons".'), join(res, f))
cpSync(join(root, 'packages', 'brand', 'assets', 'theama.ico'), join(app, 'icon.ico'))

// --- notices -----------------------------------------------------------------------------------------------------------
execFileSync(process.execPath, [join(root, 'tools', 'package', 'notices.mjs'), join(res, 'THIRD-PARTY-NOTICES.txt')], { stdio: 'inherit' })
// The project's own licence is the owner's choice; it is included when a LICENSE file exists.
if (existsSync(join(root, 'LICENSE'))) cpSync(join(root, 'LICENSE'), join(res, 'LICENSE.txt'))

console.log(`\nStaged in ${stage}`)
