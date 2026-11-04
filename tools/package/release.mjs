// Publishes the installer built by "yarn dist" as a GitHub Release, which is the feed the installed app updates from.
//   node tools/package/release.mjs [--notes "text"] [--draft]
// Needs the GitHub CLI (gh), signed in with "gh auth login". The version comes from apps/desktop/package.json, the tag is v<version>.
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = join(root, 'build', 'installer')
const version = JSON.parse(readFileSync(join(root, 'apps', 'desktop', 'package.json'), 'utf8')).version
const tag = `v${version}`
const args = process.argv.slice(2)
const draft = args.includes('--draft')
const notesAt = args.indexOf('--notes')
const notes = notesAt >= 0 ? args[notesAt + 1] : undefined

function fail(message) {
  console.error(message)
  process.exit(1)
}

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
if (exists) fail(`Release ${tag} already exists. Bump "version" in apps/desktop/package.json and run "yarn dist" again.`)

const create = ['release', 'create', tag, ...files, '--title', `Theama ${version}`, '--notes', notes ?? `Theama ${version}`]
if (draft) create.push('--draft')
console.log(`Publishing ${tag}${draft ? ' (draft: installed apps will not see it until you publish it)' : ''}...`)
try {
  console.log(gh(...create).trim())
} catch (err) {
  fail(`gh release create failed:\n${err.stderr || err.message}`)
}
