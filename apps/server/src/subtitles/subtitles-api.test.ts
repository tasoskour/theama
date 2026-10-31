import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FileSubtitles, LaunchInfo, MediaFilePage, SubtitleProviders, SubtitleSearchResults, SubtitleDownloadResult } from '@theama/contracts'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'
import { startFakeSubtitles, SUBTITLE_TEST_KEY, SUBTITLE_TEST_PASSWORD, type FakeSubtitles } from '../../../../tools/fake-subtitles/server'

let dir: string
let media: string
let fake: FakeSubtitles
let server: RunningServer
let base: string
let ids: { movie: number; episode: number }
let config: ReturnType<typeof loadConfig>
const send = (method: string, path: string, body?: unknown) => fetch(`${base}${path}`, {
  method, headers: { Authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const configure = async (provider: 'opensubtitles' | 'subdl') => {
  const res = await send('PUT', `/subtitles/providers/${provider}/credentials`, { apiKey: SUBTITLE_TEST_KEY })
  expect(res.status).toBe(200)
  return SubtitleProviders.parse(await res.json())
}
async function search(id: number, provider: 'opensubtitles' | 'subdl' = 'opensubtitles') {
  const res = await send('POST', `/library/files/${id}/subtitles/search`, { provider, languages: ['el'], title: id === ids.movie ? 'Film' : 'Show' })
  expect(res.status).toBe(200)
  return SubtitleSearchResults.parse(await res.json()).results[0]!
}
beforeAll(async () => {
  fake = await startFakeSubtitles()
  dir = mkdtempSync(join(tmpdir(), 'theama-subtitles-api-'))
  media = join(dir, 'Ταινίες'); mkdirSync(media)
  for (const name of ['Film.2020.mkv', 'Show.S01E01.mkv']) writeFileSync(join(media, name), Buffer.alloc(131072, 1))
  config = loadConfig({ THEAMA_DATA_DIR: join(dir, 'data'), THEAMA_PORT: '0', THEAMA_OPENSUBTITLES_API_BASE: fake.openSubtitlesBase, THEAMA_SUBDL_API_BASE: fake.subdlBase, THEAMA_SUBDL_DOWNLOAD_BASE: fake.origin })
  server = await startServer(config)
  base = `http://127.0.0.1:${server.port}/api/v1`
  expect((await send('POST', '/library/sources', { path: media, libraryType: 'auto' })).status).toBe(201)
  let files: MediaFilePage['items'] = []
  for (let attempt = 0; attempt < 100; attempt++) {
    files = MediaFilePage.parse(await (await send('GET', '/library/files')).json()).items
    if (files.length === 2) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  expect(files).toHaveLength(2)
  ids = { movie: files.find((f) => f.kind === 'movie')!.id, episode: files.find((f) => f.kind === 'episode')!.id }
})
beforeEach(() => { fake.state.mode = 'normal'; fake.state.expireToken = false; fake.state.requests = [] })
afterAll(async () => {
  await server?.stop('test finished'); await fake?.close()
  const child = relative(tmpdir(), dir)
  if (isAbsolute(child) || !/^theama-subtitles-api-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
  await rm(dir, { recursive: true, force: true })
})

describe('authenticated subtitle API', () => {
  it('requires authentication, validates inputs and reports missing setup', async () => {
    expect((await fetch(`${base}/subtitles/providers`)).status).toBe(401)
    const request = { provider: 'opensubtitles', languages: ['el'], title: 'Film' }
    expect((await send('POST', `/library/files/${ids.movie}/subtitles/search`, request)).status).toBe(409)
    expect((await send('POST', `/library/files/${ids.movie}/subtitles/search`, { ...request, languages: ['../el'] })).status).toBe(400)
    expect((await send('PUT', '/subtitles/providers/unknown/credentials', { apiKey: 'x' })).status).toBe(400)
    expect((await send('POST', '/library/files/999999/subtitles/search', request)).status).toBe(404)
  })
  it('saves a movie subtitle and the next launch discovers it without rescanning', async () => {
    await configure('opensubtitles')
    const hit = await search(ids.movie)
    const path = `/library/files/${ids.movie}/subtitles/download`
    const res = await send('POST', path, { resultId: hit.id, url: 'file:///C:/Windows/test', destination: 'C:/Windows/test' })
    expect(SubtitleDownloadResult.parse(await res.json())).toEqual({ state: 'saved', fileName: 'Film.2020.el.srt' })
    const listed = FileSubtitles.parse(await (await send('GET', `/library/files/${ids.movie}/subtitles`)).json())
    expect(listed.chosen).toMatchObject({ fileName: 'Film.2020.el.srt', language: 'el' })
    const launch = LaunchInfo.parse(await (await send('GET', `/playback/files/${ids.movie}/launch`)).json())
    expect(launch.subtitle).toEqual({ path: join(media, 'Film.2020.el.srt'), language: 'el' })
    expect((await send('POST', path, { resultId: hit.id })).status).toBe(409)
    expect(readFileSync(join(media, 'Film.2020.el.srt'), 'utf8')).toContain('Καλημέρα')
  })
  it('saves SubDL episode ZIPs and rejects stale or cross-file references', async () => {
    await configure('subdl')
    const hit = await search(ids.episode, 'subdl')
    expect(fake.state.requests.at(-1)!.query).toMatchObject({ season_number: '1', episode_number: '1', languages: 'EL', full_season: '0' })
    expect((await send('POST', `/library/files/${ids.movie}/subtitles/download`, { resultId: hit.id })).status).toBe(409)
    expect((await send('POST', `/library/files/${ids.episode}/subtitles/download`, { resultId: randomUUID() })).status).toBe(409)
    const res = await send('POST', `/library/files/${ids.episode}/subtitles/download`, { resultId: hit.id })
    expect(SubtitleDownloadResult.parse(await res.json())).toEqual({ state: 'saved', fileName: 'Show.S01E01.el.srt' })
  })
  it('keeps credentials in secrets, hides them from responses/logs/reports, and restores setup after restart', async () => {
    await configure('opensubtitles')
    const login = await send('POST', '/subtitles/opensubtitles/login', { username: 'viewer', password: SUBTITLE_TEST_PASSWORD })
    const loginText = await login.text()
    expect(loginText).not.toContain(SUBTITLE_TEST_KEY)
    expect(loginText).not.toContain(SUBTITLE_TEST_PASSWORD)
    for (const path of ['/settings', '/subtitles/providers', '/diagnostics/report']) {
      const text = await (await send('GET', path)).text()
      expect(text).not.toContain(SUBTITLE_TEST_KEY)
      expect(text).not.toContain(SUBTITLE_TEST_PASSWORD)
    }
    const secrets = readFileSync(join(config.secretsDir, 'subtitles.json'), 'utf8')
    expect(secrets).toContain(SUBTITLE_TEST_PASSWORD)
    for (const name of await readdir(config.logsDir)) {
      const text = readFileSync(join(config.logsDir, name), 'utf8')
      expect(text).not.toContain(SUBTITLE_TEST_KEY)
      expect(text).not.toContain(SUBTITLE_TEST_PASSWORD)
    }
    await server.stop('test restart')
    server = await startServer(config); base = `http://127.0.0.1:${server.port}/api/v1`
    const status = SubtitleProviders.parse(await (await send('GET', '/subtitles/providers')).json())
    expect(status.providers.find((p) => p.id === 'opensubtitles')).toMatchObject({ configured: true, loggedIn: true })
    const logout = SubtitleProviders.parse(await (await send('DELETE', '/subtitles/opensubtitles/login')).json())
    expect(logout.providers[0]).toMatchObject({ configured: true, loggedIn: false })
  })
  it('reports provider quota failures without leaking upstream responses', async () => {
    fake.state.mode = 'quota'
    const res = await send('POST', `/library/files/${ids.movie}/subtitles/search`, { provider: 'opensubtitles', languages: ['el'], title: 'Film' })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: { code: 'subtitle_quota' } })
  })
  it('reports a video that disappeared after search', async () => {
    const hit = await search(ids.movie)
    await rm(join(media, 'Film.2020.mkv'))
    const res = await send('POST', `/library/files/${ids.movie}/subtitles/download`, { resultId: hit.id })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'subtitle_file_unavailable' } })
  })
})
