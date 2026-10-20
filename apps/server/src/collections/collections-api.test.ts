import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CollectionDetail, CollectionList, LibraryStatus, MetadataStatus, TitleDetail, TitlePage, type TitleSummary } from '@theama/contracts'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../../tools/fake-tmdb/server.mjs'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'

let dir: string
let media: string
let personal: string
let fake: FakeTmdb
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
const titles = async (query = '') => TitlePage.parse(await get(`/library/titles?limit=200${query}`)).items
const detail = async (key: string) => TitleDetail.parse(await get(`/library/title?key=${encodeURIComponent(key)}`))
const collection = async (id: number, order = '') => CollectionDetail.parse(await get(`/collections/${id}${order}`))
const byTitle = async (name: string): Promise<TitleSummary> => {
  const found = (await titles()).find((t) => t.title === name)
  if (!found) throw new Error(`no title "${name}" in ${JSON.stringify((await titles()).map((t) => t.title))}`)
  return found
}
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code

async function until<T>(what: string, probe: () => Promise<T | false>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await probe()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}
const idle = () =>
  until('scans and metadata to settle', async () => {
    const s = MetadataStatus.parse(await get('/metadata/status'))
    const scanning = LibraryStatus.parse(await get('/library/status')).scanning
    return !scanning && s.pending === 0 && s.state === 'idle' ? s : false
  })
const rescan = async () => {
  await send('POST', '/library/sources/1/scan')
  await new Promise((r) => setTimeout(r, 100))
  await idle()
}
const touch = (...names: string[]) => names.forEach((n) => writeFileSync(join(media, n), 'x'))
const collectionRequests = () => fake.requests.filter((r) => r.path.startsWith('/collection/')).length

beforeAll(async () => {
  fake = await startFakeTmdb()
  dir = mkdtempSync(join(tmpdir(), 'theama-coll-'))
  media = join(dir, 'Βιβλιοθήκη')
  personal = join(dir, 'Personal')
  mkdirSync(media, { recursive: true })
  mkdirSync(personal)
  touch(
    'Mad.Max.1979.1080p.mkv',
    'Mad.Max.Fury.Road.2015.1080p.mkv',
    'Interstellar.2014.1080p.mkv',
    'Severance.S01E01.1080p.mkv',
    'Severance.S01E01.720p.mkv', // a second copy of the same episode
    'Severance.S01E03.1080p.mkv', // S01E02 is missing
    'Severance.S01E09.1080p.mkv', // the provider has no such episode
    'Doctor.Who.S01E01.mkv', // ambiguous: never identified here, so no provider data
  )
  writeFileSync(join(personal, 'Trip to Crete.mp4'), 'x')
  server = await startServer(
    loadConfig({
      THEAMA_DATA_DIR: join(dir, 'data'),
      THEAMA_PORT: '0',
      THEAMA_FFPROBE: 'none',
      THEAMA_TMDB_API_BASE: fake.url,
      THEAMA_TMDB_IMAGE_BASE: fake.imageUrl,
    }),
  )
  base = `http://127.0.0.1:${server.port}/api/v1`
  expect((await send('POST', '/library/sources', { path: media, libraryType: 'auto' })).status).toBe(201)
  expect((await send('POST', '/library/sources', { path: personal, libraryType: 'videos' })).status).toBe(201)
  await until('first scans', async () => (await titles()).length >= 6)
})
afterAll(async () => {
  await server.stop('test finished')
  await fake.close()
  await rm(dir, { recursive: true, force: true })
})

describe('before any key', () => {
  it('has no collections and no coverage', async () => {
    expect(CollectionList.parse(await get('/collections')).items).toEqual([])
    const sev = await byTitle('Severance')
    expect(sev.missingEpisodes).toBeNull()
    expect((await detail(sev.key)).coverage).toBeNull()
  })
})

describe('series coverage', () => {
  it('says which aired episodes are missing, which are upcoming, and keeps odd files visible', async () => {
    expect((await send('PUT', '/metadata/credentials', { tmdbApiKey: GOOD_KEY })).status).toBe(200)
    await idle()
    const sev = await byTitle('Severance')
    // Aired and absent: S1E02 and S2E01. The 2099 episode is upcoming, not missing.
    expect(sev.missingEpisodes).toBe(2)

    const d = await detail(sev.key)
    expect(d.coverage?.seasons).toEqual([
      { season: 1, expected: 3, local: 2, missing: 1, upcoming: 0, undated: 0, notInProvider: 1, duplicates: 1 },
      { season: 2, expected: 2, local: 0, missing: 1, upcoming: 1, undated: 0, notInProvider: 0, duplicates: 0 },
    ])
    expect(d.episodes.map((e) => [e.season, e.episode, e.status])).toEqual([
      [1, 1, 'local'], [1, 2, 'missing'], [1, 3, 'local'], [2, 1, 'missing'], [2, 2, 'upcoming'],
    ])
    const dup = d.episodes.find((e) => e.season === 1 && e.episode === 1)!
    expect(dup.fileIds).toHaveLength(2)
    const stray = d.files.find((f) => f.episode === 9)!
    expect(d.coverage?.unmatchedFileIds).toEqual([stray.id])
  })

  it('a multi-episode file covers both episodes it holds', async () => {
    touch('Severance.S01E02-E03.mkv')
    await rescan()
    const sev = await byTitle('Severance')
    expect(sev.missingEpisodes).toBe(1) // only S2E01 is still missing
    const d = await detail(sev.key)
    expect(d.episodes.find((e) => e.season === 1 && e.episode === 2)?.status).toBe('local')
    expect(d.coverage?.seasons[0]).toMatchObject({ season: 1, local: 3, missing: 0, duplicates: 2 })
  })

  it('an unidentified series has no coverage, and personal videos never get any metadata', async () => {
    const who = await byTitle('Doctor Who')
    expect(who.missingEpisodes).toBeNull()
    expect((await detail(who.key)).coverage).toBeNull()
    expect((await byTitle('Trip to Crete')).missingEpisodes).toBeNull()
  })
})

describe('official collections', () => {
  it('builds the set from the provider, showing what the library lacks as non-playable entries', async () => {
    const list = CollectionList.parse(await get('/collections?kind=official'))
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({ kind: 'official', name: 'Mad Max Collection', memberCount: 4, localCount: 2 })
    expect(list.items[0]!.posterUrl).toMatch(/^\/api\/v1\/artwork\/poster-madmax-collection\.png$/)

    const c = await collection(list.items[0]!.id)
    expect(c.orders).toEqual(['release'])
    expect(c.members.map((m) => [m.position, m.title, m.year, m.key !== null])).toEqual([
      [1, 'Mad Max', 1979, true],
      [2, 'Mad Max 2', 1981, false],
      [3, 'Mad Max Beyond Thunderdome', 1985, false],
      [4, 'Mad Max: Fury Road', 2015, true],
    ])
    const missing = c.members[1]!
    expect(missing.summary).toBeNull() // contextual: nothing to open or play
    expect(missing.posterUrl).toMatch(/madmax2\.png$/)
    expect(c.members[2]!.posterUrl).toBeNull()
    expect(c.members[0]!.summary).toMatchObject({ kind: 'movie', matchState: 'matched' })
  })

  it('tells a movie which collections it is in', async () => {
    const d = await detail((await byTitle('Mad Max')).key)
    expect(d.collections).toEqual([{ id: expect.any(Number), kind: 'official', name: 'Mad Max Collection' }])
    expect((await detail((await byTitle('Interstellar')).key)).collections).toEqual([])
  })

  it('links a missing member the moment it is added, without asking the provider again', async () => {
    const before = collectionRequests()
    touch('Mad.Max.2.1981.mkv')
    await rescan()
    const [c] = CollectionList.parse(await get('/collections?kind=official')).items
    expect(c).toMatchObject({ localCount: 3, memberCount: 4 })
    const members = (await collection(c!.id)).members
    expect(members[1]).toMatchObject({ title: 'Mad Max 2', summary: expect.objectContaining({ kind: 'movie' }) })
    expect(collectionRequests()).toBe(before) // the set was already known
  })

  it('cannot be edited or deleted by the person', async () => {
    const [c] = CollectionList.parse(await get('/collections?kind=official')).items
    const key = (await byTitle('Interstellar')).key
    const patched = await send('PATCH', `/collections/${c!.id}`, { name: 'Mine' })
    expect(patched.status).toBe(403)
    expect(await errorCode(patched)).toBe('not_editable')
    expect((await send('DELETE', `/collections/${c!.id}`)).status).toBe(403)
    expect((await send('POST', `/collections/${c!.id}/members`, { key })).status).toBe(403)
    expect((await send('PUT', `/collections/${c!.id}/order`, { keys: [key] })).status).toBe(403)
  })

  it('offers release order only: story order needs curated data and is never inferred', async () => {
    const [c] = CollectionList.parse(await get('/collections?kind=official')).items
    expect((await collection(c!.id, '?order=custom')).order).toBe('release') // custom is not offered; falls back
  })
})

describe('your own collections', () => {
  let id = 0

  it('creates one with a first title, and refuses a duplicate name', async () => {
    const sev = await byTitle('Severance')
    const res = await send('POST', '/collections', { name: 'Weekend picks', key: sev.key })
    expect(res.status).toBe(201)
    const c = CollectionDetail.parse(await res.json())
    id = c.summary.id
    expect(c).toMatchObject({ order: 'custom', orders: ['custom', 'release'], summary: { kind: 'user', name: 'Weekend picks', memberCount: 1, localCount: 1 } })
    expect((await send('POST', '/collections', { name: 'weekend PICKS' })).status).toBe(409)
    expect((await send('POST', '/collections', { name: '   ' })).status).toBe(400)
  })

  it('adds titles, rejects unknown ones, and ignores a title added twice', async () => {
    const fury = await byTitle('Mad Max: Fury Road')
    const interstellar = await byTitle('Interstellar')
    for (const key of [fury.key, interstellar.key, fury.key]) expect((await send('POST', `/collections/${id}/members`, { key })).status).toBe(200)
    expect((await send('POST', `/collections/${id}/members`, { key: 'movie:nothing:' })).status).toBe(404)
    expect((await send('POST', '/collections/9999/members', { key: fury.key })).status).toBe(404)
    const c = await collection(id)
    expect(c.members.map((m) => m.title)).toEqual(['Severance', 'Mad Max: Fury Road', 'Interstellar'])
  })

  it('keeps a custom order, and can also show release order', async () => {
    const keys = [(await byTitle('Interstellar')).key, (await byTitle('Severance')).key, (await byTitle('Mad Max: Fury Road')).key]
    const res = await send('PUT', `/collections/${id}/order`, { keys })
    expect(res.status).toBe(200)
    expect(CollectionDetail.parse(await res.json()).members.map((m) => m.title)).toEqual(['Interstellar', 'Severance', 'Mad Max: Fury Road'])
    // Release order: 2014, 2015, then the series (year 2022).
    expect((await collection(id, '?order=release')).members.map((m) => m.title)).toEqual(['Interstellar', 'Mad Max: Fury Road', 'Severance'])
    // The custom order is still what it was.
    expect((await collection(id)).members.map((m) => m.title)).toEqual(['Interstellar', 'Severance', 'Mad Max: Fury Road'])
  })

  it('refuses an order that names a stranger or repeats a title, and changes nothing', async () => {
    const sev = (await byTitle('Severance')).key
    expect((await send('PUT', `/collections/${id}/order`, { keys: [sev, 'movie:nothing:'] })).status).toBe(400)
    expect((await send('PUT', `/collections/${id}/order`, { keys: [sev, sev] })).status).toBe(400)
    expect((await collection(id)).members.map((m) => m.title)).toEqual(['Interstellar', 'Severance', 'Mad Max: Fury Road'])
  })

  it('a partial order puts the named titles first and keeps the rest in their order', async () => {
    const fury = (await byTitle('Mad Max: Fury Road')).key
    await send('PUT', `/collections/${id}/order`, { keys: [fury] })
    expect((await collection(id)).members.map((m) => m.title)).toEqual(['Mad Max: Fury Road', 'Interstellar', 'Severance'])
  })

  it('shows up on the title page, and renaming is reflected there', async () => {
    const sev = await byTitle('Severance')
    expect((await detail(sev.key)).collections).toEqual([{ id, kind: 'user', name: 'Weekend picks' }])
    const res = await send('PATCH', `/collections/${id}`, { name: 'Friday night' })
    expect(CollectionDetail.parse(await res.json()).summary.name).toBe('Friday night')
    expect((await detail(sev.key)).collections[0]?.name).toBe('Friday night')
    expect((await send('PATCH', `/collections/${id}`, { name: 'Friday night' })).status).toBe(200) // same name, same collection
  })

  it('finds collections by words of their name, ignoring accents and capitals', async () => {
    expect(CollectionList.parse(await get('/collections?q=FRIDAY')).items.map((c) => c.name)).toEqual(['Friday night'])
    expect(CollectionList.parse(await get('/collections?q=mad%20max')).items.map((c) => c.name)).toEqual(['Mad Max Collection'])
    expect(CollectionList.parse(await get('/collections?q=night%20fri')).items).toHaveLength(1) // every word, in any order
    expect(CollectionList.parse(await get('/collections?q=zzz')).items).toEqual([])
    expect(CollectionList.parse(await get('/collections?q=mad&kind=user')).items).toEqual([])
  })

  it('lists it next to the official ones, filtered by kind', async () => {
    expect(CollectionList.parse(await get('/collections')).items.map((c) => c.name)).toEqual(['Friday night', 'Mad Max Collection'])
    expect(CollectionList.parse(await get('/collections?kind=user')).items.map((c) => c.name)).toEqual(['Friday night'])
  })

  it('removes a member without touching the title, and a vanished title stays as a non-playable entry', async () => {
    const trip = await byTitle('Trip to Crete')
    await send('POST', `/collections/${id}/members`, { key: trip.key })
    expect((await collection(id)).summary).toMatchObject({ memberCount: 4, localCount: 4 })

    // Remove the folder that holds it: the member keeps its name but can no longer be opened.
    const sources = (await get('/library/sources')) as { items: { id: number; path: string }[] }
    const other = sources.items.find((s) => s.path.endsWith('Personal'))!
    expect((await send('DELETE', `/library/sources/${other.id}`)).status).toBe(200)
    const gone = (await collection(id)).members.find((m) => m.title === 'Trip to Crete')!
    expect(gone).toMatchObject({ key: null, summary: null })
    expect((await collection(id)).summary).toMatchObject({ memberCount: 4, localCount: 3 })

    const res = await send('DELETE', `/collections/${id}/members?key=${encodeURIComponent(trip.key)}`)
    expect(res.status).toBe(200)
    expect((await collection(id)).members).toHaveLength(3)
  })

  it('deleting it removes the grouping only', async () => {
    const before = (await titles()).length
    expect((await send('DELETE', `/collections/${id}`)).status).toBe(200)
    expect((await send('GET', `/collections/${id}`)).status).toBe(404)
    expect((await titles()).length).toBe(before)
    expect((await detail((await byTitle('Severance')).key)).collections).toEqual([])
  })
})

describe('when the library no longer has any of it', () => {
  it('an official collection disappears from the list, and comes back with the files', async () => {
    const [official] = CollectionList.parse(await get('/collections?kind=official')).items
    expect(official).toBeDefined()
    expect((await send('DELETE', '/library/sources/1')).status).toBe(200)
    expect(CollectionList.parse(await get('/collections?kind=official')).items).toEqual([])
    // The stored set is kept, so it is back as soon as the folder is added again.
    expect((await send('POST', '/library/sources', { path: media, libraryType: 'auto' })).status).toBe(201)
    await until('collection to return', async () => CollectionList.parse(await get('/collections?kind=official')).items.length === 1)
  })
})
