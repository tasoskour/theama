import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ContinueList, FileSubtitles, LaunchInfo, LibraryStatus, TitleDetail, TitlePage, type TitleSummary } from '@theama/contracts'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'

let dir: string
let media: string
let server: RunningServer
let base: string
const auth = () => ({ Authorization: `Bearer ${server.token}` })
const get = async (path: string) => (await fetch(`${base}${path}`, { headers: auth() })).json() as Promise<unknown>
const send = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...auth(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const titles = async () => TitlePage.parse(await get('/library/titles?limit=200')).items
const byTitle = async (name: string): Promise<TitleSummary> => {
  const found = (await titles()).find((t) => t.title === name)
  if (!found) throw new Error(`no title "${name}" in ${JSON.stringify((await titles()).map((t) => t.title))}`)
  return found
}
const detail = async (key: string) => TitleDetail.parse(await get(`/library/title?key=${encodeURIComponent(key)}`))
const episodeId = async (n: number): Promise<number> => {
  const d = await detail((await byTitle('Show')).key)
  return d.files.find((f) => f.episode === n)!.id
}
const watchedEpisodes = async (): Promise<number[]> => (await detail((await byTitle('Show')).key)).files.filter((f) => f.watched).map((f) => f.episode!)

async function until<T>(what: string, probe: () => Promise<T | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await probe()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'theama-play-'))
  media = join(dir, 'Βιβλιοθήκη')
  mkdirSync(media, { recursive: true })
  for (const f of [
    'Show.S01E01.mkv', 'Show.S01E02.mkv', 'Show.S01E03.mkv', 'Show.S02E01.mkv',
    'Show.S01E01.el.srt', 'Show.S01E01.en.srt', 'Show.S01E02.fr.srt',
    'Film.2020.1080p.mkv',
  ]) {
    writeFileSync(join(media, f), 'x')
  }
  server = await startServer(loadConfig({ THEAMA_DATA_DIR: join(dir, 'data'), THEAMA_PORT: '0', THEAMA_FFPROBE: 'none' }))
  base = `http://127.0.0.1:${server.port}/api/v1`
  expect((await send('POST', '/library/sources', { path: media, libraryType: 'auto' })).status).toBe(201)
  await until('scan', async () => !LibraryStatus.parse(await get('/library/status')).scanning && (await titles()).length >= 2)
})
afterAll(async () => {
  await server.stop('test finished')
  await rm(dir, { recursive: true, force: true })
})

describe('watched state', () => {
  it('starts with nothing watched and no "continue" items', async () => {
    expect((await byTitle('Show')).watchState).toBe('none')
    expect(ContinueList.parse(await get('/playback/continue')).items).toEqual([])
    const d = await detail((await byTitle('Show')).key)
    expect(d.playback).toMatchObject({ next: { season: 1, episode: 1, label: 'S01E01' }, lastPlayedAt: null })
    expect(d.files.every((f) => !f.watched && f.lastPlayedAt === null)).toBe(true)
  })

  it('marks one episode watched: the series is "some", the next episode moves on, and it appears under continue', async () => {
    expect((await send('PUT', `/playback/files/${await episodeId(1)}`, { watched: true })).status).toBe(200)
    const show = await byTitle('Show')
    expect(show.watchState).toBe('some')
    expect((await detail(show.key)).playback.next).toMatchObject({ label: 'S01E02' })
    const items = ContinueList.parse(await get('/playback/continue')).items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: 'S01E02', summary: { title: 'Show' } })
  })

  it('can be undone', async () => {
    await send('PUT', `/playback/files/${await episodeId(1)}`, { watched: false })
    expect((await byTitle('Show')).watchState).toBe('none')
    expect(ContinueList.parse(await get('/playback/continue')).items).toEqual([])
  })

  it('marks a whole season, then the whole title, and reports a finished series as "all" with nothing next', async () => {
    const key = (await byTitle('Show')).key
    const season = await send('PUT', '/playback/titles', { key, watched: true, season: 1 })
    expect(await season.json()).toEqual({ changed: 3 })
    expect(await watchedEpisodes()).toEqual([1, 2, 3])
    expect((await detail(key)).playback.next).toMatchObject({ label: 'S02E01' })

    await send('PUT', '/playback/titles', { key, watched: true })
    const show = await byTitle('Show')
    expect(show.watchState).toBe('all')
    expect((await detail(key)).playback.next).toBeNull()
    expect(ContinueList.parse(await get('/playback/continue')).items).toEqual([]) // caught up: nothing to continue

    await send('PUT', '/playback/titles', { key, watched: false })
    expect((await byTitle('Show')).watchState).toBe('none')
  })

  it('rejects unknown files and titles', async () => {
    expect((await send('PUT', '/playback/files/99999', { watched: true })).status).toBe(404)
    expect((await send('PUT', '/playback/titles', { key: 'series:nothing', watched: true })).status).toBe(404)
    expect((await send('PUT', '/playback/files/1', { watched: 'yes' })).status).toBe(400)
  })

  it('a film is watched or not, and a started-but-unfinished film is offered to continue', async () => {
    const film = await byTitle('Film')
    const fileId = (await detail(film.key)).files[0]!.id
    expect(film.watchState).toBe('none')
    expect((await send('POST', `/playback/files/${fileId}/launched`)).status).toBe(200)
    // Starting is not finishing.
    expect((await byTitle('Film')).watchState).toBe('none')
    const items = ContinueList.parse(await get('/playback/continue')).items
    expect(items.map((i) => [i.summary.title, i.label, i.fileId])).toEqual([['Film', null, fileId]])
    expect((await detail(film.key)).playback.lastPlayedAt).not.toBeNull()
    await send('PUT', `/playback/files/${fileId}`, { watched: true })
    expect((await byTitle('Film')).watchState).toBe('all')
    expect(ContinueList.parse(await get('/playback/continue')).items).toEqual([])
  })
})

describe('where playback stopped', () => {
  const report = (id: number, positionSeconds: number, durationSeconds: number | null, final = false) =>
    send('PUT', `/playback/files/${id}/progress`, { positionSeconds, durationSeconds, final }).then(async (r) => ({ status: r.status, ...((await r.json()) as { outcome: string }) }))
  const resume = async (id: number) => LaunchInfo.parse(await get(`/playback/files/${id}/launch`)).resumeSeconds

  it('ignores anything under five minutes', async () => {
    const id = await episodeId(1)
    expect(await report(id, 299, 2700)).toMatchObject({ status: 200, outcome: 'ignored' })
    expect(await resume(id)).toBeNull()
    expect((await detail((await byTitle('Show')).key)).playback.next).toMatchObject({ label: 'S01E01', resumeSeconds: null })
  })

  it('remembers the minute after five, and offers it to the player, the next-episode button and the continue rail', async () => {
    const id = await episodeId(1)
    expect(await report(id, 754, 2700)).toMatchObject({ outcome: 'saved' })
    expect(await resume(id)).toBe(754)
    const d = await detail((await byTitle('Show')).key)
    expect(d.playback.next).toMatchObject({ label: 'S01E01', resumeSeconds: 754 })
    expect(d.files.find((f) => f.id === id)).toMatchObject({ positionSeconds: 754, watched: false })
    const items = ContinueList.parse(await get('/playback/continue')).items
    expect(items.find((i) => i.summary.title === 'Show')).toMatchObject({ label: 'S01E01', resumeSeconds: 754 })
    // A later short look does not erase it.
    expect(await report(id, 30, 2700)).toMatchObject({ outcome: 'ignored' })
    expect(await resume(id)).toBe(754)
  })

  it('counts the file as watched from 90 %, which moves the next episode on and clears the position', async () => {
    const id = await episodeId(1)
    expect(await report(id, 2430, 2700, true)).toMatchObject({ outcome: 'watched' })
    expect(await resume(id)).toBeNull()
    const d = await detail((await byTitle('Show')).key)
    expect(d.files.find((f) => f.id === id)).toMatchObject({ watched: true, positionSeconds: null })
    expect(d.playback.next).toMatchObject({ label: 'S01E02', resumeSeconds: null })
    // Rewatching a watched file part-way changes nothing.
    expect(await report(id, 600, 2700)).toMatchObject({ outcome: 'ignored' })
    expect((await detail((await byTitle('Show')).key)).playback.next).toMatchObject({ label: 'S01E02' })
  })

  it('without a known length it keeps the position but never decides "watched"', async () => {
    const id = await episodeId(2)
    expect(await report(id, 5000, null)).toMatchObject({ outcome: 'saved' })
    expect(await resume(id)).toBe(5000)
  })

  it('marking unwatched starts fresh, and bad input is refused', async () => {
    const id = await episodeId(2)
    await send('PUT', `/playback/files/${id}`, { watched: false })
    expect(await resume(id)).toBeNull()
    expect((await report(99999, 600, 2700)).status).toBe(404)
    expect((await send('PUT', `/playback/files/${id}/progress`, { positionSeconds: -5 })).status).toBe(400)
    await send('PUT', '/playback/titles', { key: (await byTitle('Show')).key, watched: false })
    expect((await byTitle('Show')).watchState).toBe('none')
  })
})

describe('starting a player', () => {
  it('gives the shell the path and the subtitle that fits the language preferences (Greek first by default)', async () => {
    const info = LaunchInfo.parse(await get(`/playback/files/${await episodeId(1)}/launch`))
    expect(info.path).toBe(join(media, 'Show.S01E01.mkv'))
    expect(info.subtitle).toEqual({ path: join(media, 'Show.S01E01.el.srt'), language: 'el' })
    expect(info.subtitleLanguages).toEqual(['el', 'en'])
  })

  it('follows a changed preference, and starts without a subtitle when none fits', async () => {
    await send('PUT', '/settings', { subtitleLanguages: ['en'] })
    expect(LaunchInfo.parse(await get(`/playback/files/${await episodeId(1)}/launch`)).subtitle?.language).toBe('en')
    // E02 only has a French subtitle.
    expect(LaunchInfo.parse(await get(`/playback/files/${await episodeId(2)}/launch`)).subtitle).toBeNull()
    await send('PUT', '/settings', { subtitleLanguages: ['el', 'en'] })
    expect((await send('PUT', '/settings', { subtitleLanguages: ['english'] })).status).toBe(400)
  })

  it('lists embedded and external subtitles of a file', async () => {
    const subs = FileSubtitles.parse(await get(`/library/files/${await episodeId(1)}/subtitles`))
    expect(subs.external.map((s) => s.language).sort()).toEqual(['el', 'en'])
    expect(subs.chosen?.language).toBe('el')
    expect(subs.embedded).toEqual([]) // FFprobe is off in this run
  })

  it('records a launch without marking anything watched, and counts it', async () => {
    const id = await episodeId(3)
    await send('POST', `/playback/files/${id}/launched`)
    await send('POST', `/playback/files/${id}/launched`)
    const f = (await detail((await byTitle('Show')).key)).files.find((x) => x.id === id)!
    expect(f.lastPlayedAt).not.toBeNull()
    expect(f.watched).toBe(false)
    expect((await send('POST', '/playback/files/99999/launched')).status).toBe(404)
  })

  it('refuses to start a file on a drive that is not connected, and one that is unknown', async () => {
    expect((await send('GET', '/playback/files/99999/launch')).status).toBe(404)
    const away = join(dir, 'away')
    await rename(media, away)
    await get('/library/sources') // refreshes availability
    const res = await send('GET', `/playback/files/${await episodeId(1)}/launch`)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unavailable')
    // The state survives the drive being away.
    await rename(away, media)
    await get('/library/sources')
  })
})
