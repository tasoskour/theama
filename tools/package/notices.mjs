// Writes THIRD-PARTY-NOTICES.txt: every package that ends up inside what Theama ships (the backend bundle, the
// interface, the desktop shell), with its licence and, where the licence asks for it, the licence text; plus the
// programs that travel beside the app (Node.js, NSSM, FFprobe), fonts, and the TMDB attribution.
// Electron and Chromium add their own LICENSE and LICENSES.chromium.html next to the installed app.
//
//   node tools/package/notices.mjs <output file>
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = process.argv[2]
if (!out) throw new Error('Give the output file as the argument.')

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** Finds a package the way Node would: in the nearest node_modules above `from`. */
function locate(name, from) {
  let dir = from
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const start = [
  ['apps/server', 'the backend'],
  ['apps/ui', 'the interface'],
  ['apps/desktop', 'the desktop app'],
].map(([dir]) => join(root, dir))

const found = new Map() // name@version -> info
const queue = []
for (const dir of start) {
  const pkg = read(join(dir, 'package.json'))
  for (const name of Object.keys(pkg.dependencies ?? {})) queue.push([name, dir])
}
while (queue.length > 0) {
  const [name, from] = queue.pop()
  if (name.startsWith('@theama/')) {
    const pkgDir = join(root, name === '@theama/contracts' ? 'packages/contracts' : name === '@theama/logs' ? 'packages/logs' : 'packages/' + name.slice(8))
    if (existsSync(join(pkgDir, 'package.json'))) for (const dep of Object.keys(read(join(pkgDir, 'package.json')).dependencies ?? {})) queue.push([dep, pkgDir])
    continue
  }
  const dir = locate(name, from)
  if (!dir) continue
  const pkg = read(join(dir, 'package.json'))
  const id = `${pkg.name}@${pkg.version}`
  if (found.has(id)) continue
  const licenseFile = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f))
  found.set(id, {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see package'),
    homepage: pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? '',
    text: licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').trim() : null,
  })
  for (const dep of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})]) queue.push([dep, dir])
}

const packages = [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
const lines = []
const add = (s = '') => lines.push(s)
const rule = '='.repeat(78)

add('THEAMA - THIRD-PARTY NOTICES')
add()
add('Theama is built from the software below. Each part keeps its own licence.')
add()
add(rule)
add('PROGRAMS THAT TRAVEL WITH THEAMA')
add(rule)
add()
add('Node.js (resources\\node\\node.exe) - MIT licence. https://nodejs.org  Runs the Theama background service.')
add('NSSM, the Non-Sucking Service Manager (resources\\nssm\\nssm.exe) - public domain. https://nssm.cc  Runs Theama as a Windows service.')
add('FFprobe from FFmpeg (resources\\ffprobe\\ffprobe.exe) - an FFmpeg "essentials" build from https://www.gyan.dev/ffmpeg/builds/ , licensed under the GNU')
add('  General Public License v3 (the licence text and readme of that build are in resources\\ffprobe). FFprobe is started as a separate program to read')
add('  duration, resolution and codecs; Theama does not link to it or modify it. The source of FFmpeg is available from https://ffmpeg.org/download.html')
add('  and the build scripts from gyan.dev. You may replace ffprobe.exe with your own build.')
add('Electron and Chromium - their licences are installed beside the app (LICENSE, LICENSES.chromium.html).')
add()
add(rule)
add('DATA AND FONTS')
add(rule)
add()
add('This product uses the TMDB API but is not endorsed or certified by TMDB. Film and series information and images come from themoviedb.org.')
add('Fonts: Inter and Noto Serif Display, SIL Open Font License 1.1 (@fontsource-variable packages below).')
add()
add(rule)
add(`PACKAGES (${packages.length})`)
add(rule)
add()
for (const p of packages) add(`${p.name} ${p.version} - ${p.license}${p.homepage ? ` - ${p.homepage}` : ''}`)
add()
add(rule)
add('LICENCE TEXTS')
add(rule)
const seen = new Set()
for (const p of packages) {
  if (!p.text) continue
  const key = p.text.replace(/\s+/g, ' ').slice(0, 2000)
  if (seen.has(key)) {
    add()
    add(`--- ${p.name} ${p.version}: same text as above (${p.license}) ---`)
    continue
  }
  seen.add(key)
  add()
  add(`--- ${p.name} ${p.version} (${p.license}) ---`)
  add(p.text)
}
add()

writeFileSync(out, lines.join('\r\n'), 'utf8')
console.log(`Wrote ${out} (${packages.length} packages)`)
