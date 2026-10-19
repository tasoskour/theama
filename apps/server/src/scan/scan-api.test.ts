import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibraryStatus, MediaFilePage, ScanJob, ScanJobList } from '@theama/contracts'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'

let dir: string
let media: string
let server: RunningServer
let base: string
const auth = () => ({ Authorization: `Bearer ${server.token}` })
const get = async (path: string) => (await fetch(`${base}${path}`, { headers: auth() })).json() as Promise<unknown>
const post = (path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...auth(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function waitForScans(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!LibraryStatus.parse(await get('/library/status')).scanning) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('scan did not finish')
}

const files = async (query = '') => MediaFilePage.parse(await get(`/library/files${query}`))

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'theama-scanapi-'))
  media = join(dir, 'Βιβλιοθήκη')
  mkdirSync(join(media, 'Dark', 'Season 1'), { recursive: true })
  mkdirSync(join(media, 'Dark', 'Featurettes'), { recursive: true })
  writeFileSync(join(media, 'Interstellar.2014.2160p.BluRay.x265.mkv'), 'x')
  writeFileSync(join(media, 'Dune.Part.Two.2024.1080p.WEB-DL.mkv'), 'x')
  writeFileSync(join(media, 'Dark', 'Season 1', 'Dark.S01E01.Secrets.1080p.mkv'), 'x')
  writeFileSync(join(media, 'Dark', 'Season 1', 'Dark.S01E02.Lies.1080p.mkv'), 'x')
  writeFileSync(join(media, 'Dark', 'Season 1', 'Dark.S01E02.Lies.srt'), 'x')
  writeFileSync(join(media, 'Dark', 'Featurettes', 'Behind the scenes.mkv'), 'x')
  writeFileSync(join(media, 'Trip to Crete.mp4'), 'x')
  server = await startServer(loadConfig({ THEAMA_DATA_DIR: join(dir, 'data'), THEAMA_PORT: '0', THEAMA_FFPROBE: 'none' }))
  base = `http://127.0.0.1:${server.port}/api/v1`
})
afterAll(async () => {
  await server.stop('test finished')
  await rm(dir, { recursive: true, force: true })
})

describe('scanning through the API', () => {
  let sourceId = 0

  it('adding a folder starts a scan automatically', async () => {
    const res = await post('/library/sources', { path: media, libraryType: 'auto' })
    expect(res.status).toBe(201)
    sourceId = ((await res.json()) as { id: number }).id
    await waitForScans()
    const jobs = ScanJobList.parse(await get('/scans'))
    expect(jobs.items[0]).toMatchObject({ sourceId, status: 'done', summary: { found: 6, new: 6 } })
    expect(jobs.items[0]!.diagnostics.join(' ')).toMatch(/FFprobe was not found/)
  })

  it('lists files classified by kind, with extras hidden by default', async () => {
    const all = await files()
    expect(all.total).toBe(5)
    expect(all.items.map((f) => `${f.kind}:${f.title}`)).toEqual(['episode:Dark', 'episode:Dark', 'movie:Dune Part Two', 'movie:Interstellar', 'video:Trip to Crete'])
    expect(all.items.every((f) => f.state === 'available' && f.probed === false)).toBe(true)

    const episodes = await files('?kind=episode')
    expect(episodes.items.map((f) => [f.season, f.episode, f.episodeTitle])).toEqual([[1, 1, 'Secrets'], [1, 2, 'Lies']])
    expect((await files('?kind=extra')).items.map((f) => f.title)).toEqual(['Behind the scenes'])
    expect((await files('?kind=movie')).items.map((f) => f.year)).toEqual([2024, 2014])
  })

  it('searches the guessed title, episode title and path (case-insensitively for Latin)', async () => {
    expect((await files('?q=interstellar')).items.map((f) => f.title)).toEqual(['Interstellar'])
    expect((await files('?q=lies')).items.map((f) => f.episode)).toEqual([2])
    expect((await files('?q=nothing-like-this')).total).toBe(0)
  })

  it('pages with a stable cursor', async () => {
    const first = await files('?limit=2')
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()
    expect(first.total).toBe(5)
    const second = await files(`?limit=2&cursor=${first.nextCursor}`)
    const third = await files(`?limit=2&cursor=${second.nextCursor}`)
    const ids = [...first.items, ...second.items, ...third.items].map((f) => f.id)
    expect(new Set(ids).size).toBe(5)
    expect(third.nextCursor).toBeNull()
  })

  it('a manual scan is accepted, picks up a new file and recognises a rename', async () => {
    writeFileSync(join(media, 'New.Film.2023.mkv'), 'x')
    await rename(join(media, 'Trip to Crete.mp4'), join(media, 'Crete 2019.mp4'))
    const res = await post(`/library/sources/${sourceId}/scan`)
    expect(res.status).toBe(202)
    expect(ScanJob.parse(await res.json()).sourceId).toBe(sourceId)
    await waitForScans()
    const latest = ScanJobList.parse(await get('/scans')).items[0]!
    expect(latest.summary).toMatchObject({ new: 1, moved: 1, missing: 0 })
    expect((await files()).total).toBe(6)
  })

  it('reports unknown folders and scans', async () => {
    expect((await post('/library/sources/9999/scan')).status).toBe(404)
    expect((await fetch(`${base}/scans/9999`, { headers: auth() })).status).toBe(404)
    expect((await post('/scans/9999/cancel')).status).toBe(404)
  })

  it('shows files of an unplugged folder as offline (kept, not deleted) and brings them back', async () => {
    const hidden = join(dir, 'hidden-away')
    await rename(media, hidden)
    await get('/library/sources') // re-checks availability
    const offline = await files()
    expect(offline.total).toBe(6)
    expect(offline.items.every((f) => f.state === 'source_offline')).toBe(true)
    expect((await files('?hideUnavailable=true')).total).toBe(0)

    await rename(hidden, media)
    await get('/library/sources')
    await waitForScans()
    expect((await files()).items.every((f) => f.state === 'available')).toBe(true)
  })

  it('reports library status', async () => {
    expect(LibraryStatus.parse(await get('/library/status'))).toMatchObject({ ffprobeAvailable: false, fileCount: 6, scanning: false })
  })

  it('removing the folder removes its files from the list but never from disk', async () => {
    const { existsSync } = await import('node:fs')
    expect((await fetch(`${base}/library/sources/${sourceId}`, { method: 'DELETE', headers: auth() })).status).toBe(200)
    expect((await files()).total).toBe(0)
    expect(existsSync(join(media, 'Interstellar.2014.2160p.BluRay.x265.mkv'))).toBe(true)
  })
})
