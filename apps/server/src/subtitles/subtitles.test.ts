import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CredentialStore } from '../metadata/credentials'
import { movieHash } from './hash'
import { subtitleContents } from './content'
import { SubtitleService, SUBTITLE_RESULT_TTL, releaseSimilarity, type SubtitleFile } from './service'
import { GREEK_SRT, startFakeSubtitles, SUBTITLE_TEST_KEY, SUBTITLE_TEST_PASSWORD, type FakeSubtitles } from '../../../../tools/fake-subtitles/server'

let dir: string
let fake: FakeSubtitles
let file: SubtitleFile
let service: SubtitleService
let clock = 0
let counter = 0
beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), 'theama-subtitles-')); fake = await startFakeSubtitles() })
afterAll(async () => {
  await fake.close()
  const child = relative(tmpdir(), dir)
  if (isAbsolute(child) || !/^theama-subtitles-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
  await rm(dir, { recursive: true, force: true })
})
beforeEach(() => {
  counter++; clock = 0
  fake.state.mode = 'normal'; fake.state.requests = []; fake.state.expireToken = false; fake.state.beforeDownload = null; fake.state.downloads = 0; fake.state.logins = 0
  const path = join(dir, `Film.${counter}.mkv`)
  writeFileSync(path, Buffer.alloc(131072, 1))
  file = { path, available: true, title: 'Film', kind: 'movie', year: 2020, season: null, episode: null, imdbId: 'tt1234567', tmdbId: '42' }
  service = new SubtitleService({ store: new CredentialStore(join(dir, `secrets-${counter}.json`)), file: (id) => id === 1 || id === 2 ? file : null,
    openSubtitlesBase: fake.openSubtitlesBase, subdlBase: fake.subdlBase, subdlDownloadBase: fake.origin, now: () => clock })
})
async function result(provider: 'opensubtitles' | 'subdl' = 'opensubtitles') {
  await service.setKey(provider, SUBTITLE_TEST_KEY)
  return (await service.search(1, { provider, language: 'el', title: 'Film' })).results[0]!
}

describe('subtitle content and matching', () => {
  it('calculates little-endian hashes, wraps overflow and skips small videos', async () => {
    const path = join(dir, 'hash.mkv')
    writeFileSync(path, Buffer.alloc(131072, 0xff))
    expect(await movieHash(path)).toBe('000000000001c000')
    writeFileSync(path, 'small')
    expect(await movieHash(path)).toBeNull()
  })
  it('validates supported formats and normalizes Greek text to UTF-8', () => {
    for (const [fileName, text] of [
      ['x.srt', GREEK_SRT], ['x.vtt', 'WEBVTT\n\n00:01.000 --> 00:03.000\nΓεια'],
      ['x.ass', '[Script Info]\n[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Γεια'],
      ['x.ssa', '[Events]\nDialogue: Marked=0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Γεια'],
    ]) expect(subtitleContents({ fileName: fileName!, bytes: strToU8(text!) }, 'el')[0]!.format).toBe(fileName!.split('.').at(-1))
    const legacy = Uint8Array.from([...strToU8('1\n00:00:01,000 --> 00:00:03,000\n'), 0xc1]) // Greek capital alpha in Windows-1253
    expect(new TextDecoder().decode(subtitleContents({ fileName: 'x.srt', bytes: legacy }, 'el')[0]!.bytes)).toContain('Α')
    expect(releaseSimilarity('C:\\Film.2020.1080p.mkv', 'Film.2020.1080p')).toBeGreaterThan(releaseSimilarity('C:\\Film.2020.1080p.mkv', 'Film.DVD'))
  })
  it('rejects HTML, corrupt archives, traversal and oversized archive entries', () => {
    for (const bytes of [strToU8('<html>not subtitles</html>'), new Uint8Array([80, 75, 1]),
      zipSync({ '../escape.srt': strToU8(GREEK_SRT) }), zipSync({ 'huge.srt': new Uint8Array(3 * 1024 * 1024) }),
    ]) expect(() => subtitleContents({ fileName: 'x.srt', bytes }, 'el')).toThrow()
  })
})

describe('subtitle providers and saving', () => {
  it('ranks hash matches and sends authoritative identifiers, language and moviehash', async () => {
    const hit = await result()
    expect(hit).toMatchObject({ hashMatch: true, language: 'el', rating: 8.5, format: 'srt' })
    const request = fake.state.requests.at(-1)!
    expect(request.query).toMatchObject({ imdb_id: '1234567', languages: 'el', type: 'movie' })
    expect(request.query.moviehash).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(hit)).not.toContain('remoteId')
    expect(await service.download(1, hit.id)).toMatchObject({ state: 'saved', fileName: `Film.${counter}.el.srt` })
    expect(readFileSync(join(dir, `Film.${counter}.el.srt`), 'utf8')).toContain('Καλημέρα')
  })
  it('uses an edited title instead of stored identifiers and passes episode filters to both providers', async () => {
    file = { ...file, kind: 'episode', season: 2, episode: 3 }
    for (const provider of ['opensubtitles', 'subdl'] as const) {
      await service.setKey(provider, SUBTITLE_TEST_KEY)
      const response = await service.search(1, { provider, language: 'el', title: 'Corrected show' })
      expect(response.results.length).toBeGreaterThan(0)
      const request = fake.state.requests.at(-1)!
      expect(request.query).toMatchObject({ season_number: '2', episode_number: '3' })
      expect(request.query.imdb_id).toBeUndefined()
      expect(request.query[provider === 'subdl' ? 'film_name' : 'query']).toMatch(/corrected show/i)
    }
  })
  it('supports SubDL Greek names, excludes season packs and saves ZIP contents', async () => {
    const hit = await result('subdl')
    expect(fake.state.requests.at(-1)!.query).toMatchObject({ imdb_id: 'tt1234567', languages: 'EL', full_season: '0' })
    expect(await service.download(1, hit.id)).toMatchObject({ state: 'saved' })
  })
  it('lets users select an archive entry without downloading or consuming quota twice', async () => {
    const hit = await result('subdl')
    fake.state.mode = 'multi'
    const selection = await service.download(1, hit.id)
    expect(selection.state).toBe('select')
    if (selection.state !== 'select') throw new Error('Expected file choice')
    expect(selection.files).toHaveLength(2)
    await service.download(1, hit.id, selection.files[1]!.id)
    expect(fake.state.downloads).toBe(1)
    expect(readFileSync(join(dir, `Film.${counter}.el.srt`), 'utf8')).toContain('Καλησπέρα')
  })
  it('renews an expired login once, persists credentials and removes the account on logout', async () => {
    await service.setKey('opensubtitles', SUBTITLE_TEST_KEY)
    await service.login('viewer', SUBTITLE_TEST_PASSWORD)
    await service.search(1, { provider: 'opensubtitles', language: 'el', title: 'Film' })
    const before = fake.state.logins
    fake.state.expireToken = true
    await service.search(1, { provider: 'opensubtitles', language: 'el', title: 'Film' })
    expect(fake.state.logins).toBe(before + 1)
    expect(service.secrets()).toContain(SUBTITLE_TEST_PASSWORD)
    expect(JSON.stringify(service.status())).not.toContain(SUBTITLE_TEST_KEY)
    service.logout()
    expect(service.status().providers[0]).toMatchObject({ configured: true, loggedIn: false })
    expect(service.secrets()).not.toContain(SUBTITLE_TEST_PASSWORD)
  })
  it('keeps a working key when replacement is rejected and reports quotas and outages', async () => {
    await result()
    await expect(service.setKey('opensubtitles', 'wrong-key')).rejects.toMatchObject({ apiCode: 'subtitle_forbidden' })
    expect(service.status().providers[0]!.configured).toBe(true)
    fake.state.mode = 'quota'
    await expect(service.search(1, { provider: 'opensubtitles', language: 'el', title: 'Film' })).rejects.toMatchObject({ apiCode: 'subtitle_quota' })
    fake.state.mode = 'unavailable'
    await expect(service.search(1, { provider: 'opensubtitles', language: 'el', title: 'Film' })).rejects.toMatchObject({ apiCode: 'subtitle_provider_unavailable' })
  })
  it('binds results to their file, expiry and original path', async () => {
    const hit = await result()
    await expect(service.download(2, hit.id)).rejects.toMatchObject({ apiCode: 'subtitle_stale_result' })
    clock += SUBTITLE_RESULT_TTL
    await expect(service.download(1, hit.id)).rejects.toMatchObject({ apiCode: 'subtitle_stale_result' })
    clock = 0; file = { ...file, available: false }
    await expect(service.download(1, hit.id)).rejects.toMatchObject({ apiCode: 'subtitle_file_unavailable' })
    file = { ...file, available: true, path: join(dir, 'moved.mkv') }; writeFileSync(file.path, 'x')
    await expect(service.download(1, hit.id)).rejects.toMatchObject({ apiCode: 'subtitle_stale_result' })
  })
  it('rechecks the path after a slow download', async () => {
    const hit = await result()
    fake.state.beforeDownload = async () => {
      const target = join(dir, `moved-${counter}.mkv`)
      await rename(file.path, target)
      file = { ...file, path: target }
    }
    await expect(service.download(1, hit.id)).rejects.toMatchObject({ apiCode: 'subtitle_stale_result' })
    expect(existsSync(join(dir, `Film.${counter}.el.srt`))).toBe(false)
  })
  it('preserves existing files and permits only one concurrent creation', async () => {
    const hit = await result()
    const outcomes = await Promise.allSettled([service.download(1, hit.id), service.download(1, hit.id)])
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(fake.state.downloads).toBe(1)
    const path = join(dir, `Film.${counter}.el.srt`)
    writeFileSync(path, 'Existing subtitle')
    await expect(service.download(1, hit.id)).rejects.toMatchObject({ apiCode: 'subtitle_exists' })
    expect(readFileSync(path, 'utf8')).toBe('Existing subtitle')
  })
  it('reports write failures without removing existing destination directories', async () => {
    const hit = await result()
    const target = join(dir, `Film.${counter}.el.srt`)
    await mkdir(target)
    await expect(service.download(1, hit.id)).rejects.toMatchObject({ apiCode: expect.stringMatching(/subtitle_(exists|write_failed)/) })
    expect(existsSync(target)).toBe(true)
  })
  it('rejects unsafe download hosts and invalid content without creating subtitle files', async () => {
    for (const mode of ['external', 'html', 'unsafe'] as const) {
      const hit = await result()
      fake.state.mode = mode
      await expect(service.download(1, hit.id)).rejects.toMatchObject({ apiCode: 'subtitle_invalid_download' })
      fake.state.mode = 'normal'
    }
    expect(readdirSync(dir).filter((name) => name === `Film.${counter}.el.srt`)).toHaveLength(0)
  })
})
