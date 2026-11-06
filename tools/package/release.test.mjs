import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { nextVersion, releaseOptions, runRelease } from './release.mjs'

test('accepts bump levels, legacy flags and exact versions', () => {
  assert.equal(releaseOptions([]).target, 'minor')
  for (const level of ['patch', 'minor', 'major']) {
    assert.equal(releaseOptions([level]).target, level)
    assert.equal(releaseOptions([`--${level}`]).target, level)
  }
  assert.equal(releaseOptions(['--version', '2.3.4']).target, '2.3.4')
  assert.equal(releaseOptions(['2.3.4']).target, '2.3.4')
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4')
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0')
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0')
  assert.equal(nextVersion('1.2.3', '1.2.3'), '1.2.3')
  assert.equal(nextVersion('1.2.3', '2.4.0'), '2.4.0')
})

test('rejects invalid, ambiguous and decreasing versions', () => {
  for (const args of [
    ['--version'], ['--unknown'], ['patch', 'major'], ['--minor', '--patch'],
    ['--version', '2.0.0', '--major'], ['--no-bump', 'patch'],
    ['--version', '1.2'], ['--version', '01.2.3'], ['--version', '1.2.3-beta'],
  ]) assert.throws(() => releaseOptions(args))
  assert.throws(() => nextVersion('1.2.3', '1.2.2'), /older/)
  assert.throws(() => nextVersion('1.2', 'patch'), /Invalid/)
  assert.throws(() => nextVersion('1.2.3', '9007199254740992.0.0'), /Invalid/)
})

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'theama-release-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'repo')
  const remote = join(base, 'remote.git')
  mkdirSync(root)
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  git('init', '--bare', remote)
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'release@example.invalid')
  git('config', 'core.autocrlf', 'false')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  const paths = ['package.json', 'apps/desktop/package.json', 'packages/contracts/package.json']
  for (const path of paths) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), '{\n  "name": "fixture",\n  "version": "1.1.0"\n}\n')
  }
  writeFileSync(join(root, '.gitignore'), 'build/\n')
  writeFileSync(join(root, 'source.txt'), 'original\n')
  git('add', '.')
  git('commit', '-m', 'initial')
  git('remote', 'add', 'origin', remote)
  git('push', '-u', 'origin', 'main')
  const initial = git('rev-parse', 'HEAD')
  const calls = []
  const state = { failBuild: false, failInstall: false, failPush: false, failPublish: false, releaseExists: false, stale: false, remoteTag: undefined }
  const version = () => JSON.parse(readFileSync(join(root, paths[1]), 'utf8')).version
  const artifacts = () => {
    const dir = join(root, 'build/installer')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `Theama-Setup-${version()}.exe`), 'installer')
    writeFileSync(join(dir, `Theama-Setup-${version()}.exe.blockmap`), 'blockmap')
    writeFileSync(join(dir, 'latest.yml'), `version: ${state.stale ? '0.0.0' : version()}\n`)
  }
  const execute = (command, args, options) => {
    calls.push([command, ...args])
    if (command === 'gh') {
      if (args[0] === 'release' && args[1] === 'view' && !state.releaseExists) {
        throw Object.assign(new Error('not found'), { stderr: 'release not found' })
      }
      if (args[0] === 'release' && args[1] === 'create') {
        // Reproduce gh 2.20.2, which cannot publish with --verify-tag.
        assert.ok(!args.includes('--verify-tag'), 'unknown flag: --verify-tag')
        if (state.failPublish) throw new Error('publication unavailable')
        // Publication must see both the branch and tag at the release commit on the remote.
        const refs = git('ls-remote', 'origin', 'refs/heads/main', `refs/tags/${args[2]}`)
        assert.equal(refs.split('\n').length, 2)
        assert.ok(refs.split('\n').every((line) => line.startsWith(`${git('rev-parse', 'HEAD')}\t`)))
        return 'https://example.invalid/release'
      }
      return ''
    }
    if (command === process.execPath) {
      if (args[1] === 'install') {
        assert.deepEqual(args.slice(1), ['install', '--immutable'])
        if (state.failInstall) throw new Error('dependency install failed')
      } else {
        assert.ok(['dist', 'dist:signed'].includes(args[1]))
        if (state.failBuild) throw new Error('build failed')
        artifacts()
      }
      return ''
    }
    if (command === 'git' && args[0] === 'push' && state.failPush) throw new Error('push rejected')
    if (command === 'git' && args[0] === 'ls-remote' && state.remoteTag !== undefined) return state.remoteTag
    return execFileSync(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  return { root, git, paths, initial, state, calls, version, artifacts,
    release: (args = []) => runRelease({ root, args, execute }) }
}

test('builds, commits every version file and pushes the exact release tag before publishing', (t) => {
  const f = fixture(t)
  const notes = 'Quotes " and spaces; $(literal)'
  f.release(['patch', '--signed', '--draft', '--notes', notes])
  assert.equal(f.version(), '1.1.1')
  assert.equal(f.git('status', '--porcelain'), '')
  assert.equal(f.git('log', '-1', '--format=%s'), 'chore(release): v1.1.1')
  assert.deepEqual(f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(), f.paths.sort())
  assert.equal(f.git('rev-parse', 'v1.1.1'), f.git('rev-parse', 'HEAD'))
  const create = f.calls.find((call) => call[0] === 'gh' && call[2] === 'create')
  const verify = f.calls.find((call) => call[0] === 'git' && call[1] === 'ls-remote')
  assert.deepEqual(verify, ['git', 'ls-remote', '--refs', 'origin', 'refs/tags/v1.1.1'])
  assert.ok(f.calls.indexOf(verify) < f.calls.indexOf(create))
  assert.equal(create[create.indexOf('--target') + 1], f.git('rev-parse', 'HEAD'))
  assert.equal(create[create.indexOf('--notes') + 1], notes)
  assert.ok(create.includes('--draft'))
  assert.ok(f.calls.some((call) => call[0] === process.execPath && call[2] === 'dist:signed'))
})

test('can build an exact version already left by a failed release', (t) => {
  const f = fixture(t)
  for (const path of f.paths) {
    writeFileSync(join(f.root, path), readFileSync(join(f.root, path), 'utf8').replace('1.1.0', '1.2.0'))
  }
  f.release(['--version', '1.2.0'])
  assert.equal(f.version(), '1.2.0')
  assert.equal(f.git('show', 'v1.2.0:apps/desktop/package.json'), f.git('show', 'HEAD:apps/desktop/package.json'))
})

for (const failure of ['failInstall', 'failBuild', 'stale']) {
  test(`${failure} leaves the original version contents and creates no commit, push or release`, (t) => {
    const f = fixture(t)
    const before = f.paths.map((path) => readFileSync(join(f.root, path), 'utf8'))
    f.state[failure] = true
    assert.throws(() => f.release(['major']), /version files restored/)
    assert.deepEqual(f.paths.map((path) => readFileSync(join(f.root, path), 'utf8')), before)
    assert.equal(f.git('rev-parse', 'HEAD'), f.initial)
    assert.equal(f.git('tag', '--list'), '')
    assert.ok(!f.calls.some((call) => call[0] === 'git' && call[1] === 'push'))
    assert.ok(!f.calls.some((call) => call[0] === 'gh' && call[2] === 'create'))
  })
}

test('rejects unrelated working tree and staged changes before any install/build or publication', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'source.txt'), 'changed\n')
  assert.throws(() => f.release(), /Commit your source/)
  f.git('add', 'source.txt')
  writeFileSync(join(f.root, 'source.txt'), 'original\n')
  assert.throws(() => f.release(), /Commit staged source/)
  assert.equal(f.git('rev-parse', 'HEAD'), f.initial)
  assert.ok(f.calls.every((call) => call[0] === 'git'))
})

for (const failure of ['failPush', 'failPublish']) {
  test(`${failure} can be retried with --no-bump without another commit or build`, (t) => {
    const f = fixture(t)
    f.state[failure] = true
    assert.throws(() => f.release(['minor']), /retry.*--no-bump/i)
    const commit = f.git('rev-parse', 'HEAD')
    assert.notEqual(commit, f.initial)
    if (failure === 'failPush') assert.ok(!f.calls.some((call) => call[0] === 'gh' && call[2] === 'create'))
    f.calls.length = 0
    f.state[failure] = false
    f.release(['--no-bump'])
    assert.equal(f.git('rev-parse', 'HEAD'), commit)
    assert.equal(f.version(), '1.2.0')
    assert.ok(!f.calls.some((call) => call[0] === process.execPath))
  })
}

test('--no-bump commits pending version files and publishes existing artifacts', (t) => {
  const f = fixture(t)
  for (const path of f.paths) {
    writeFileSync(join(f.root, path), readFileSync(join(f.root, path), 'utf8').replace('1.1.0', '1.2.0'))
  }
  f.artifacts()
  f.release(['--no-bump'])
  assert.equal(f.git('log', '-1', '--format=%s'), 'chore(release): v1.2.0')
  assert.ok(!f.calls.some((call) => call[0] === process.execPath))
})

test('an existing release fails before changing versions', (t) => {
  const f = fixture(t)
  f.state.releaseExists = true
  assert.throws(() => f.release(['major']), /already exists/)
  assert.equal(f.version(), '1.1.0')
  assert.equal(f.git('rev-parse', 'HEAD'), f.initial)
})

test('preserves staged non-version edits in a package manifest', (t) => {
  const f = fixture(t)
  const path = join(f.root, 'package.json')
  const before = readFileSync(path, 'utf8')
  writeFileSync(path, before.replace('fixture', 'edited-name'))
  f.git('add', 'package.json')
  writeFileSync(path, before)
  assert.throws(() => f.release(['patch']), /Commit non-version changes/)
  assert.match(f.git('show', ':package.json'), /edited-name/)
  assert.equal(f.git('rev-parse', 'HEAD'), f.initial)
})

test('a conflicting remote tag prevents both the branch push and publication', (t) => {
  const f = fixture(t)
  f.git('tag', 'v1.2.0', f.initial)
  f.git('push', 'origin', 'refs/tags/v1.2.0')
  f.git('tag', '-d', 'v1.2.0')
  assert.throws(() => f.release(['minor']), /Push failed/)
  const remoteRefs = f.git('ls-remote', 'origin', 'refs/heads/main', 'refs/tags/v1.2.0')
  assert.ok(remoteRefs.split('\n').every((line) => line.startsWith(`${f.initial}\t`)))
  assert.ok(!f.calls.some((call) => call[0] === 'gh' && call[2] === 'create'))
})

for (const remoteTag of ['', `${'0'.repeat(40)}\trefs/tags/v1.2.0`]) {
  test(`refuses publication when the pushed remote tag is ${remoteTag ? 'different' : 'missing'}`, (t) => {
    const f = fixture(t)
    f.state.remoteTag = remoteTag
    assert.throws(() => f.release(['minor']), /Remote tag v1\.2\.0 is missing or does not point/)
    assert.ok(!f.calls.some((call) => call[0] === 'gh' && call[2] === 'create'))
    f.state.remoteTag = undefined
    f.calls.length = 0
    f.release(['--no-bump'])
    assert.ok(f.calls.some((call) => call[0] === 'gh' && call[2] === 'create'))
    assert.ok(!f.calls.some((call) => call[0] === process.execPath))
  })
}
