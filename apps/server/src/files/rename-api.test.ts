import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibraryStatus, OperationBatch, OperationList, RenameApplyResult, RenamePreview, TitleDetail, TitlePage, type RenameItem, type TitleSummary } from '@theama/contracts'
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
const detail = async (name: string) => TitleDetail.parse(await get(`/library/title?key=${encodeURIComponent((await byTitle(name)).key)}`))
const preview = async (names: string[], extra: Record<string, unknown> = {}) => {
  const keys = await Promise.all(names.map(async (n) => (await byTitle(n)).key))
  const res = await send('POST', '/files/rename/preview', { keys, ...extra })
  return { status: res.status, body: res.status === 200 ? RenamePreview.parse(await res.json()) : await res.json() }
}
const approve = (items: RenameItem[]) => items.filter((i) => i.status === 'ok').map((i) => ({ from: i.from, to: i.to }))
const disk = async () => (await readdir(media)).sort()

async function until<T>(what: string, probe: () => Promise<T | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await probe()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}
const scan = async () => {
  await send('POST', '/library/sources/1/scan')
  await new Promise((r) => setTimeout(r, 100))
  await until('scan', async () => !LibraryStatus.parse(await get('/library/status')).scanning)
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'theama-rename-'))
  media = join(dir, 'Βιβλιοθήκη')
  mkdirSync(media, { recursive: true })
  for (const f of [
    'Interstellar.2014.1080p.BluRay.x265.mkv',
    'Interstellar.2014.1080p.BluRay.x265.en.srt',
    'Interstellar.2014.1080p.BluRay.x265.el.srt',
    'Dark.S01E01.Secrets.mkv',
    'Dark.S01E02.Lies.mkv',
    'Dark.S01E02.Lies.srt',
    'Dune.2021.1080p.mkv',
    'Dune.2021.720p.mkv',
    'Arrival.2016.1080p.mkv',
  ]) {
    writeFileSync(join(media, f), 'x')
  }
  // Something that already has the name Arrival would be given. Not a library file.
  mkdirSync(join(media, 'Arrival (2016).mkv'))
  const personal = join(dir, 'Personal')
  mkdirSync(personal)
  writeFileSync(join(personal, 'Trip to Crete.mp4'), 'x')
  server = await startServer(loadConfig({ THEAMA_DATA_DIR: join(dir, 'data'), THEAMA_PORT: '0', THEAMA_FFPROBE: 'none' }))
  base = `http://127.0.0.1:${server.port}/api/v1`
  expect((await send('POST', '/library/sources', { path: media, libraryType: 'auto' })).status).toBe(201)
  expect((await send('POST', '/library/sources', { path: personal, libraryType: 'videos' })).status).toBe(201)
  await until('first scan', async () => !LibraryStatus.parse(await get('/library/status')).scanning && (await titles()).length >= 5)
})
afterAll(async () => {
  await server.stop('test finished')
  await rm(dir, { recursive: true, force: true })
})

describe('preview', () => {
  it('shows each rename, takes subtitles along, and flags collisions without touching anything', async () => {
    const before = await disk()
    const { status, body } = await preview(['Interstellar', 'Dark', 'Dune', 'Arrival'])
    expect(status).toBe(200)
    const p = body as RenamePreview
    const row = (name: string) => p.items.find((i) => i.fromName === name)!

    expect(row('Interstellar.2014.1080p.BluRay.x265.mkv')).toMatchObject({ toName: 'Interstellar (2014).mkv', status: 'ok', kind: 'video' })
    expect(row('Interstellar.2014.1080p.BluRay.x265.en.srt')).toMatchObject({ toName: 'Interstellar (2014).en.srt', status: 'ok', kind: 'subtitle', fileId: null })
    expect(row('Interstellar.2014.1080p.BluRay.x265.el.srt')).toMatchObject({ toName: 'Interstellar (2014).el.srt', status: 'ok' })
    expect(row('Dark.S01E01.Secrets.mkv')).toMatchObject({ toName: 'Dark - S01E01 - Secrets.mkv', status: 'ok' })
    expect(row('Dark.S01E02.Lies.srt')).toMatchObject({ toName: 'Dark - S01E02 - Lies.srt', status: 'ok' })
    // Two files want "Dune (2021).mkv": neither gets it.
    expect(p.items.filter((i) => i.fromName.startsWith('Dune.'))).toEqual([
      expect.objectContaining({ toName: 'Dune (2021).mkv', status: 'collision_batch' }),
      expect.objectContaining({ toName: 'Dune (2021).mkv', status: 'collision_batch' }),
    ])
    // Something already has that name: never overwritten.
    expect(row('Arrival.2016.1080p.mkv')).toMatchObject({ toName: 'Arrival (2016).mkv', status: 'collision_exists' })
    expect(p.counts).toMatchObject({ ok: 6, collision_batch: 2, collision_exists: 1 })
    expect(await disk()).toEqual(before)
  })

  it('uses templates from the request, and refuses ones that cannot work', async () => {
    const custom = (await preview(['Interstellar'], { movieTemplate: '{title} [{year}] {resolution}' })).body as RenamePreview
    expect(custom.items[0]?.toName).toBe('Interstellar [2014].mkv') // no probe data, so the resolution is simply left out
    for (const movieTemplate of ['{titel}', 'no names here', '{title}/{year}', '{title ({year})']) {
      const { status, body } = await preview(['Interstellar'], { movieTemplate })
      expect(status, movieTemplate).toBe(400)
      expect((body as { error: { code: string } }).error.code).toBe('invalid_template')
    }
  })

  it('refuses personal videos and unknown titles', async () => {
    const trip = await preview(['Trip to Crete'])
    expect(trip.status).toBe(400)
    expect((trip.body as { error: { code: string } }).error.code).toBe('not_renamable')
    const res = await send('POST', '/files/rename/preview', { keys: ['movie:nothing:'] })
    expect(res.status).toBe(404)
  })

  it('validates the templates saved in settings', async () => {
    expect((await send('PUT', '/settings', { renameMovieTemplate: '{title}\\{year}' })).status).toBe(400)
    expect((await send('PUT', '/settings', { renameEpisodeTemplate: '{title} {episodeCode}' })).status).toBe(200)
    const p = (await preview(['Dark'])).body as RenamePreview
    expect(p.items.find((i) => i.fromName === 'Dark.S01E01.Secrets.mkv')?.toName).toBe('Dark S01E01.mkv')
    await send('PUT', '/settings', { renameEpisodeTemplate: '{title} - {episodeCode} - {episodeTitle}' })
  })
})

describe('applying, and undoing', () => {
  let batch: OperationBatch
  let interstellarId = 0

  it('renames exactly what was approved, keeps the library in step, and leaves collisions alone', async () => {
    interstellarId = (await detail('Interstellar')).files[0]!.id
    await send('PUT', `/playback/files/${interstellarId}`, { watched: true })
    const keys = await Promise.all(['Interstellar', 'Dark', 'Dune', 'Arrival'].map(async (n) => (await byTitle(n)).key))
    const p = ((await preview(['Interstellar', 'Dark', 'Dune', 'Arrival'])).body as RenamePreview).items

    const res = await send('POST', '/files/rename/apply', { keys, approved: approve(p) })
    expect(res.status).toBe(200)
    const result = RenameApplyResult.parse(await res.json())
    batch = result.batch!
    expect(result.changed).toBe(0)
    expect(batch).toMatchObject({ total: 6, done: 6, failed: 0, rolledBack: 0, canRollback: true })

    expect(await disk()).toEqual(
      [
        'Arrival (2016).mkv', // the directory that was already there
        'Arrival.2016.1080p.mkv',
        'Dark - S01E01 - Secrets.mkv',
        'Dark - S01E02 - Lies.mkv',
        'Dark - S01E02 - Lies.srt',
        'Dune.2021.1080p.mkv',
        'Dune.2021.720p.mkv',
        'Interstellar (2014).el.srt',
        'Interstellar (2014).en.srt',
        'Interstellar (2014).mkv',
      ].sort(),
    )
    // The library follows, and the film is the same file as before: watched state included.
    const film = (await detail('Interstellar')).files[0]!
    expect(film).toMatchObject({ id: interstellarId, fileName: 'Interstellar (2014).mkv', watched: true })
    expect((await detail('Dark')).files.map((f) => f.fileName).sort()).toEqual(['Dark - S01E01 - Secrets.mkv', 'Dark - S01E02 - Lies.mkv'])
  })

  it('records every rename in the journal', async () => {
    const list = OperationList.parse(await get('/files/operations'))
    expect(list.items[0]?.id).toBe(batch.id)
    expect(list.items[0]?.items.map((i) => i.status)).toEqual(Array(6).fill('done'))
    expect(OperationBatch.parse(await get(`/files/operations/${batch.id}`)).total).toBe(6)
    expect((await send('GET', '/files/operations/not-a-uuid')).status).toBe(400)
    expect((await send('GET', '/files/operations/00000000-0000-4000-8000-000000000000')).status).toBe(404)
  })

  it('a rescan sees the same files: nothing is added, lost, or re-identified', async () => {
    const before = (await titles()).map((t) => t.key).sort()
    await scan()
    expect((await titles()).map((t) => t.key).sort()).toEqual(before)
    expect((await detail('Interstellar')).files[0]).toMatchObject({ id: interstellarId, watched: true })
  })

  it('a second preview says everything is already named that way', async () => {
    const p = (await preview(['Interstellar', 'Dark'])).body as RenamePreview
    expect(p.items.every((i) => i.status === 'unchanged')).toBe(true)
  })

  it('leaves a stale approval alone: if the plan moved on since the preview, that rename is skipped', async () => {
    const keys = [(await byTitle('Arrival')).key]
    const res = await send('POST', '/files/rename/apply', {
      keys,
      approved: [{ from: join(media, 'Arrival.2016.1080p.mkv'), to: join(media, 'Arrival (2016).mkv') }], // it was a collision
    })
    expect(RenameApplyResult.parse(await res.json())).toEqual({ batch: null, changed: 1 })
    expect(existsSync(join(media, 'Arrival.2016.1080p.mkv'))).toBe(true)
    const odd = await send('POST', '/files/rename/apply', { keys, approved: [{ from: join(media, 'Arrival.2016.1080p.mkv'), to: join(dir, 'elsewhere.mkv') }] })
    expect(RenameApplyResult.parse(await odd.json()).changed).toBe(1)
    expect(existsSync(join(dir, 'elsewhere.mkv'))).toBe(false)
  })

  it('undo puts everything back, on disk and in the library', async () => {
    const res = await send('POST', `/files/operations/${batch.id}/rollback`)
    expect(res.status).toBe(200)
    const undone = OperationBatch.parse(await res.json())
    expect(undone).toMatchObject({ done: 0, rolledBack: 6, failed: 0, canRollback: false })
    expect(await disk()).toEqual(
      [
        'Arrival (2016).mkv', 'Arrival.2016.1080p.mkv', 'Dark.S01E01.Secrets.mkv', 'Dark.S01E02.Lies.mkv', 'Dark.S01E02.Lies.srt',
        'Dune.2021.1080p.mkv', 'Dune.2021.720p.mkv', 'Interstellar.2014.1080p.BluRay.x265.el.srt', 'Interstellar.2014.1080p.BluRay.x265.en.srt', 'Interstellar.2014.1080p.BluRay.x265.mkv',
      ].sort(),
    )
    expect((await detail('Interstellar')).files[0]).toMatchObject({ id: interstellarId, fileName: 'Interstellar.2014.1080p.BluRay.x265.mkv', watched: true })
    // Undoing twice changes nothing.
    expect(OperationBatch.parse(await (await send('POST', `/files/operations/${batch.id}/rollback`)).json())).toMatchObject({ rolledBack: 6 })
    expect((await send('POST', '/files/operations/00000000-0000-4000-8000-000000000000/rollback')).status).toBe(404)
  })

  it('undo is careful: a file that changed since is reported, not forced', async () => {
    const keys = [(await byTitle('Interstellar')).key]
    const p = ((await preview(['Interstellar'])).body as RenamePreview).items
    const applied = RenameApplyResult.parse(await (await send('POST', '/files/rename/apply', { keys, approved: approve(p) })).json())
    // The person moves one of the renamed subtitles away, and something else takes the original film name.
    await rename(join(media, 'Interstellar (2014).en.srt'), join(dir, 'moved-away.srt'))
    writeFileSync(join(media, 'Interstellar.2014.1080p.BluRay.x265.el.srt'), 'someone else')
    const undone = OperationBatch.parse(await (await send('POST', `/files/operations/${applied.batch!.id}/rollback`)).json())
    const item = (name: string) => undone.items.find((i) => i.to.endsWith(name))!
    expect(item('Interstellar (2014).mkv').status).toBe('rolled_back')
    expect(item('Interstellar (2014).en.srt')).toMatchObject({ status: 'rollback_failed', error: expect.stringMatching(/no longer there/) }) // gone
    expect(item('Interstellar (2014).el.srt')).toMatchObject({ status: 'rollback_failed', error: expect.stringMatching(/original name/) }) // the old name is taken
    expect(undone).toMatchObject({ rolledBack: 1, failed: 2 })
    expect(existsSync(join(media, 'Interstellar (2014).el.srt'))).toBe(true) // left exactly where it was
    expect(existsSync(join(media, 'Interstellar.2014.1080p.BluRay.x265.mkv'))).toBe(true)
  })
})
