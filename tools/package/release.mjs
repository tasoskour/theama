// One-step release: bumps the version, builds the installer ("yarn dist") and publishes it as a GitHub Release,
// which is the feed the installed app updates from.
//   node tools/package/release.mjs [--patch | --minor | --major] [--no-bump] [--signed] [--notes "text"] [--draft]
// Default is --minor. --no-bump skips the bump and the build and only publishes what is already in build/installer.
// Needs the GitHub CLI (gh), signed in with "gh auth login". The version lives in apps/desktop/package.json (every
// workspace package.json is kept in step), the tag is v<version>.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = join(root, 'build', 'installer')
const args = process.argv.slice(2)
const draft = args.includes('--draft')
const notesAt = args.indexOf('--notes')
const notes = notesAt >= 0 ? args[notesAt + 1] : undefined
const level = args.includes('--major') ? 'major' : args.includes('--patch') ? 'patch' : 'minor'

function fail(message) {
  console.error(message)
  process.exit(1)
}

const desktopPkg = join(root, 'apps', 'desktop', 'package.json')
const readVersion = () => JSON.parse(readFileSync(desktopPkg, 'utf8')).version

function bump(v, kind) {
  const [maj, min, pat] = v.split('.').map(Number)
  if ([maj, min, pat].some(Number.isNaN)) fail(`Cannot bump version "${v}".`)
  return kind === 'major' ? `${maj + 1}.0.0` : kind === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
}

function setVersion(next) {
  // Only the "version" line is rewritten so the files keep their formatting.
  const files = [join(root, 'package.json'), desktopPkg]
  for (const w of ['apps', 'packages']) {
    for (const d of readdirSync(join(root, w))) {
      const f = join(root, w, d, 'package.json')
      if (existsSync(f) && !files.includes(f)) files.push(f)
    }
  }
  for (const f of files) {
    const before = readFileSync(f, 'utf8')
    const after = before.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${next}$2`)
    if (after === before && !before.includes(`"version": "${next}"`)) fail(`Could not update the version in ${f}.`)
    writeFileSync(f, after)
  }
}

if (!args.includes('--no-bump')) {
  const current = readVersion()
  const next = bump(current, level)
  console.log(`Bumping version ${current} -> ${next} (${level})`)
  setVersion(next)
  console.log('Building the installer...')
  try {
    execFileSync('yarn', [args.includes('--signed') ? 'dist:signed' : 'dist'], { cwd: root, stdio: 'inherit', shell: true })
  } catch {
    fail(`The build failed. The version files were already bumped to ${next}; revert them with git if you do not want that.`)
  }
}

const version = readVersion()
const tag = `v${version}`

function gh(...a) {
  return execFileSync('gh', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

const installer = `Theama-Setup-${version}.exe`
const files = [installer, `${installer}.blockmap`, 'latest.yml'].map((f) => join(dir, f))
for (const f of files) if (!existsSync(f)) fail(`${f} not found. Run "yarn dist" (or "yarn dist:signed") for version ${version} first.`)

// latest.yml must describe this version, or installed apps would be offered the wrong file.
const latest = readFileSync(files[2], 'utf8')
if (!new RegExp(`^version: ${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(latest)) fail(`latest.yml is not for version ${version}. Rebuild with "yarn dist".`)

try {
  gh('--version')
} catch {
  fail('The GitHub CLI (gh) is not installed or not on PATH. Install it from https://cli.github.com and run "gh auth login".')
}

let exists = true
try {
  gh('release', 'view', tag)
} catch {
  exists = false
}
if (exists) fail(`Release ${tag} already exists. Run "yarn release" to bump the version and publish again.`)

const create = ['release', 'create', tag, ...files, '--title', `Theama ${version}`, '--notes', notes ?? `Theama ${version}`]
if (draft) create.push('--draft')
console.log(`Publishing ${tag}${draft ? ' (draft: installed apps will not see it until you publish it)' : ''}...`)
try {
  console.log(gh(...create).trim())
} catch (err) {
  fail(`gh release create failed:\n${err.stderr || err.message}`)
}
