// Bump, build, commit and push the version and tag, then publish the GitHub Release.
// yarn release [patch|minor|major|X.Y.Z] [--version X.Y.Z] [--signed] [--notes "text"] [--draft]
// Default: minor. Legacy --patch/--minor/--major flags also work.
// --no-bump publishes an existing build and can retry a failed push/publication.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const versionLine = /^(\s*"version":\s*")[^"]*(")/m
const usage = 'Usage: yarn release [patch|minor|major|X.Y.Z] [--version X.Y.Z] [--no-bump] [--signed] [--notes "text"] [--draft]'

export function releaseOptions(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      patch: { type: 'boolean' }, minor: { type: 'boolean' }, major: { type: 'boolean' },
      version: { type: 'string' }, 'no-bump': { type: 'boolean' }, signed: { type: 'boolean' },
      notes: { type: 'string' }, draft: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  })
  const selectors = [...positionals, ...['patch', 'minor', 'major'].filter((key) => values[key])]
  if (values.version !== undefined) selectors.push(values.version)
  if (selectors.length > 1 || (values['no-bump'] && selectors.length)) {
    throw new Error(`Choose one version or bump level; --no-bump cannot be combined with either.\n${usage}`)
  }
  const target = selectors[0] ?? 'minor'
  if (!['patch', 'minor', 'major'].includes(target) && !versionPattern.test(target)) {
    throw new Error(`Invalid version "${target}". Use patch, minor, major or X.Y.Z.\n${usage}`)
  }
  return { ...values, target }
}

export function nextVersion(current, target) {
  const parts = (v) => {
    if (!versionPattern.test(v) || !v.split('.').map(Number).every(Number.isSafeInteger)) {
      throw new Error(`Invalid version "${v}"; expected X.Y.Z.`)
    }
    return v.split('.').map(Number)
  }
  const before = parts(current)
  if (['patch', 'minor', 'major'].includes(target)) {
    const index = { major: 0, minor: 1, patch: 2 }[target]
    const after = before.map((n, i) => i < index ? n : i === index ? n + 1 : 0).join('.')
    parts(after)
    return after
  }
  const after = parts(target)
  const difference = after.map((n, i) => n - before[i]).find((n) => n !== 0) ?? 0
  if (difference < 0) throw new Error(`Version ${target} is older than ${current}.`)
  return target
}

export function runRelease({ root = repoRoot, args = process.argv.slice(2), execute = execFileSync } = {}) {
  const options = releaseOptions(args)
  if (options.help) { console.log(usage); return }
  const run = (command, commandArgs, inherit = false) => execute(command, commandArgs, {
    cwd: root, encoding: 'utf8', stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  })
  const git = (...a) => run('git', a).trim()
  const gh = (...a) => run('gh', a).trim()
  // Invoke the pinned Yarn with Node, avoiding Windows .cmd/shell argument quoting.
  const yarn = (...a) => run(process.execPath, [join(root, '.yarn', 'releases', 'yarn-4.18.1.cjs'), ...a], true)
  const paths = ['package.json']
  for (const workspace of ['apps', 'packages']) {
    for (const entry of readdirSync(join(root, workspace), { withFileTypes: true })) {
      const path = `${workspace}/${entry.name}/package.json`
      if (entry.isDirectory() && existsSync(join(root, path))) paths.push(path)
    }
  }
  const readVersion = () => JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')).version
  const current = readVersion()
  const version = nextVersion(current, options['no-bump'] ? current : options.target)
  const tag = `v${version}`

  function checkChanges() {
    const changed = git('diff', 'HEAD', '--name-only', '-z').split('\0').filter(Boolean)
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
    if (untracked || changed.some((path) => !paths.includes(path))) {
      throw new Error('Commit your source changes before releasing. Only pending package version changes are allowed.')
    }
    const withoutVersion = (text) => text.replace(versionLine, '$1$2').replace(/\r\n/g, '\n').trim()
    for (const path of paths) {
      const before = git('show', `HEAD:${path}`)
      const after = readFileSync(join(root, path), 'utf8')
      const staged = git('show', `:${path}`)
      if ([after, staged].some((text) => withoutVersion(before) !== withoutVersion(text))) {
        throw new Error(`Commit non-version changes in ${path} before releasing.`)
      }
    }
    // Also catch staged changes that differ from the working tree.
    const staged = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean)
    if (staged.some((path) => !paths.includes(path))) throw new Error('Commit staged source changes before releasing.')
  }

  checkChanges()
  const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD')
  const upstream = git('for-each-ref', '--format=%(upstream:remotename)%09%(upstream:remoteref)', `refs/heads/${branch}`).split('\t')
  const remote = upstream[0] || 'origin'
  const remoteBranch = upstream[1] || `refs/heads/${branch}`
  if (remote === '.') throw new Error('The release branch must track a remote repository.')
  git('remote', 'get-url', remote)
  git('var', 'GIT_AUTHOR_IDENT')
  git('var', 'GIT_COMMITTER_IDENT')
  gh('--version')
  gh('auth', 'status')
  try {
    gh('release', 'view', tag)
    throw new Error(`Release ${tag} already exists. Choose a newer version.`)
  } catch (error) {
    if (!/release not found|HTTP 404|Not Found/i.test(String(error.stderr))) throw error
  }

  let existingTag
  try { existingTag = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`) } catch { /* not tagged yet */ }
  if (existingTag && (!options['no-bump'] || existingTag !== git('rev-parse', 'HEAD'))) {
    throw new Error(`Tag ${tag} already exists. Use --no-bump to retry publishing the same commit, or choose a newer version.`)
  }

  const snapshots = new Map(paths.map((path) => [path, readFileSync(join(root, path), 'utf8')]))
  const dir = join(root, 'build', 'installer')
  const installer = `Theama-Setup-${version}.exe`
  const files = [installer, `${installer}.blockmap`, 'latest.yml'].map((file) => join(dir, file))
  try {
    if (!options['no-bump']) {
      console.log('Installing locked dependencies...')
      yarn('install', '--immutable')
      console.log(`Setting version ${readVersion()} -> ${version}`)
      for (const [path, before] of snapshots) {
        if (!versionLine.test(before)) throw new Error(`Could not update the version in ${path}.`)
        writeFileSync(join(root, path), before.replace(versionLine, `$1${version}$2`))
      }
      console.log('Building the installer...')
      yarn(options.signed ? 'dist:signed' : 'dist')
    }
    for (const file of files) {
      if (!existsSync(file)) throw new Error(`${file} not found. Run "yarn dist" (or "yarn dist:signed") for version ${version} first.`)
    }
    const latest = readFileSync(files[2], 'utf8')
    if (!new RegExp(`^version: ${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(latest)) {
      throw new Error(`latest.yml is not for version ${version}. Rebuild with "yarn dist".`)
    }
    for (const path of paths) {
      if (JSON.parse(readFileSync(join(root, path), 'utf8')).version !== version) {
        throw new Error(`${path} is not at version ${version}. All workspace versions must match.`)
      }
    }
    checkChanges()
  } catch (error) {
    for (const [path, before] of snapshots) writeFileSync(join(root, path), before)
    throw new Error(`Release preparation failed; version files restored to their previous contents.\n${error.stderr || error.message}`, { cause: error })
  }

  if (git('diff', 'HEAD', '--name-only', '--', ...paths)) {
    run('git', ['commit', '--only', '-m', `chore(release): ${tag}`, '--', ...paths], true)
  }
  const commit = git('rev-parse', 'HEAD')
  if (existingTag && existingTag !== commit) throw new Error(`Tag ${tag} does not point to the release commit.`)
  if (!existingTag) git('tag', tag, commit)
  try {
    // Either both refs arrive or neither does. Never overwrite an existing remote tag.
    run('git', ['push', '--atomic', remote, `HEAD:${remoteBranch}`, `refs/tags/${tag}:refs/tags/${tag}`], true)
  } catch (error) {
    throw new Error(`Push failed; ${tag} is committed locally. Fix the push error, then retry with "yarn release --no-bump".\n${error.stderr || error.message}`, { cause: error })
  }

  const create = ['release', 'create', tag, ...files, '--verify-tag', '--target', commit,
    '--title', `Theama ${version}`, '--notes', options.notes ?? `Theama ${version}`]
  if (options.draft) create.push('--draft')
  console.log(`Publishing ${tag}${options.draft ? ' (draft)' : ''}...`)
  try { console.log(gh(...create)) } catch (error) {
    throw new Error(`Publication failed; the commit and tag are already pushed. Retry with "yarn release --no-bump".\n${error.stderr || error.message}`, { cause: error })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runRelease() } catch (error) { console.error(error.stderr || error.message); process.exitCode = 1 }
}
