import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GenreList, LibraryStatus, MetadataSearchResult, MetadataStatus, MetadataSuggestionDetails, MetadataSuggestionsResult, TitleDetail, TitlePage, type TitleSummary } from '@theama/contracts'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../../tools/fake-tmdb/server.mjs'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'

let dir: string
let media: string
let fake: FakeTmdb
let server: RunningServer
let base: string
let cacheDir: string
const auth = () => ({ Authorization: `Bearer ${server.token}` })
const get = async (path: string) => (await fetch(`${base}${path}`, { headers: auth() })).json() as Promise<unknown>
const send = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...auth(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const status = async () => MetadataStatus.parse(await get('/metadata/status'))
const titles = async (query = '') => TitlePage.parse(await get(`/library/titles${query}`)).items
const detail = async (key: string) => TitleDetail.parse(await get(`/library/title?key=${encodeURIComponent(key)}`))
const byTitle = async (name: string): Promise<TitleSummary> => {
  const found = (await titles('?limit=200')).find((t) => t.title === name)
  if (!found) throw new Error(`no title "${name}" in ${JSON.stringify((await titles('?limit=200')).map((t) => t.title))}`)
  return found
}

async function until<T>(what: string, probe: () => Promise<T | false>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await probe()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}
const settled = () =>
  until('metadata to settle', async () => {
    const s = await status()
    const scanning = LibraryStatus.parse(await get('/library/status')).scanning
    return !scanning && s.pending === 0 && (s.state === 'idle' || s.state === 'unavailable') ? s : false
  })

beforeAll(async () => {
  fake = await startFakeTmdb()
  dir = mkdtempSync(join(tmpdir(), 'theama-meta-'))
  media = join(dir, 'Βιβλιοθήκη')
  mkdirSync(media, { recursive: true })
  for (const f of [
    'Interstellar.2014.1080p.BluRay.mkv',
    'Parasite.2019.1080p.mkv',
    'Severance.S01E01.1080p.mkv',
    'Severance.S01E02.1080p.mkv',
    'Severance.S01E03.1080p.mkv',
    'Doctor.Who.S01E01.mkv',
    'Zxqv.Wplm.2003.mkv',
  ]) {
    writeFileSync(join(media, f), 'x')
  }
  const personal = join(dir, 'Personal')
  mkdirSync(personal)
  writeFileSync(join(personal, 'Trip to Crete.mp4'), 'x')
  const config = loadConfig({
    THEAMA_DATA_DIR: join(dir, 'data'),
    THEAMA_PORT: '0',
    THEAMA_FFPROBE: 'none',
    THEAMA_TMDB_API_BASE: fake.url,
    THEAMA_TMDB_IMAGE_BASE: fake.imageUrl,
  })
  cacheDir = config.artworkDir
  server = await startServer(config)
  base = `http://127.0.0.1:${server.port}/api/v1`
  expect((await send('POST', '/library/sources', { path: media, libraryType: 'auto' })).status).toBe(201)
  expect((await send('POST', '/library/sources', { path: personal, libraryType: 'videos' })).status).toBe(201)
  await until('first scans', async () => (await titles('?limit=200')).length >= 6)
})
afterAll(async () => {
  await server.stop('test finished')
  await fake.close()
  await rm(dir, { recursive: true, force: true })
})

describe('without a key', () => {
  it('reports that no key is set and leaves the library as scanned', async () => {
    await new Promise((r) => setTimeout(r, 150))
    expect(await status()).toMatchObject({ configured: false, state: 'no_key', matched: 0 })
    const all = await titles('?limit=200')
    expect(all.every((t) => t.posterUrl === null && t.matchState === null)).toBe(true)
    expect(fake.requests).toHaveLength(0)
  })

  it('refuses lookups with a clear error', async () => {
    const res = await send('GET', '/metadata/search?kind=movie&q=dune')
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('no_key')
    const suggestions = await send('GET', '/metadata/suggestions?section=new')
    expect(suggestions.status).toBe(409)
    expect(((await suggestions.json()) as { error: { code: string } }).error.code).toBe('no_key')
    expect((await send('GET', '/metadata/suggestions/details?kind=movie&externalId=157336')).status).toBe(409)
    expect((await send('GET', '/metadata/genres')).status).toBe(409)
  })
})

describe('credentials', () => {
  it('rejects a key TMDB does not accept and does not store it', async () => {
    const res = await send('PUT', '/metadata/credentials', { tmdbApiKey: 'definitely-not-valid-key-000000000000' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_key')
    expect((await status()).configured).toBe(false)
  })

  it('never returns the key, and keeps it out of the database and settings', async () => {
    const res = await send('PUT', '/metadata/credentials', { tmdbApiKey: GOOD_KEY })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(GOOD_KEY)
    expect(JSON.stringify(await get('/settings'))).not.toContain(GOOD_KEY)
    expect(JSON.stringify(await get('/system/info'))).not.toContain(GOOD_KEY)
    await settled()
  })

  it('rejects a key that is too short or the wrong type', async () => {
    expect((await send('PUT', '/metadata/credentials', { tmdbApiKey: 'x' })).status).toBe(400)
    expect((await send('PUT', '/metadata/credentials', { tmdbApiKey: 123 })).status).toBe(400)
  })
})

describe('automatic identification', () => {
  it('matches clear titles, asks about ambiguous ones, leaves nonsense alone, and ignores personal videos', async () => {
    const s = await settled()
    expect(s).toMatchObject({ configured: true, state: 'idle', matched: 3, ambiguous: 1, unmatched: 1, pending: 0 })

    const interstellar = await byTitle('Interstellar')
    expect(interstellar).toMatchObject({ kind: 'movie', year: 2014, matchState: 'matched', rating: 8.4 })
    expect(interstellar.posterUrl).toMatch(/^\/api\/v1\/artwork\/poster-interstellar\.png$/)

    expect(await byTitle('Severance')).toMatchObject({ kind: 'series', matchState: 'matched', year: 2022, episodeCount: 3 })
    expect(await byTitle('Doctor Who')).toMatchObject({ matchState: 'ambiguous', posterUrl: null })
    expect(await byTitle('Zxqv Wplm')).toMatchObject({ matchState: 'unmatched' })
    expect(await byTitle('Trip to Crete')).toMatchObject({ kind: 'video', matchState: null })
  })

  it('never sends personal-video names to the provider', () => {
    const queries = fake.requests.map((r) => r.query.query ?? '').join('|').toLowerCase()
    expect(queries).not.toContain('crete')
  })

  it('stores details, cast, genres and episode names with their provider', async () => {
    const d = await detail((await byTitle('Severance')).key)
    expect(d.match).toMatchObject({ state: 'matched', decidedBy: 'auto', locked: false, provider: 'tmdb', externalId: '95396' })
    expect(d.metadata).toMatchObject({
      title: 'Severance',
      tagline: 'Work-life balance, redefined.',
      genres: ['Drama', 'Sci-Fi & Fantasy'],
      rating: { source: 'tmdb', value: 8.4, votes: 3000 },
      cast: [expect.objectContaining({ name: 'Adam Scott', character: 'Mark Scout' })],
      directors: [expect.objectContaining({ name: 'Ben Stiller' })],
      imdbId: 'tt11280740',
      trailer: { site: 'youtube', key: 'xEQP4VVuyrY' },
    })
    expect(d.episodes.filter((e) => e.season === 1).map((e) => e.name)).toEqual(['Good News About Hell', 'Half Loop', 'In Perpetuity'])
    expect(d.episodes.some((e) => e.season === 2)).toBe(true)
    expect(d.credits).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Ben Stiller', category: 'director' }),
      expect.objectContaining({ name: 'Adam Scott', category: 'actor', character: 'Mark Scout' }),
    ]))
  })

  it('lists the library genres and filters titles by any of the chosen ones', async () => {
    const { genres } = GenreList.parse(await get('/library/genres'))
    expect(genres).toEqual(expect.arrayContaining(['Drama', 'Sci-Fi & Fantasy']))
    expect([...genres].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))).toEqual(genres)
    // Personal videos are never identified, so a kind with no provider data has no genres.
    expect(GenreList.parse(await get('/library/genres?kind=video')).genres).toEqual([])
    expect(GenreList.parse(await get('/library/genres?kind=series')).genres).toEqual(expect.arrayContaining(['Drama']))

    const names = async (q: string) => (await titles(q)).map((t) => t.title)
    expect(await names(`?genres=${encodeURIComponent('Sci-Fi & Fantasy')}`)).toContain('Severance')
    expect(await names(`?genres=${encodeURIComponent('Sci-Fi & Fantasy')}&kind=movie`)).not.toContain('Severance')
    // Several genres widen the result (any match), and a genre nobody has leaves nothing.
    const either = await names(`?genres=${encodeURIComponent('Sci-Fi & Fantasy|Nonexistent')}`)
    expect(either).toContain('Severance')
    expect(await names('?genres=Nonexistent')).toEqual([])
    // "all" needs every chosen genre; "any" (the default) needs one.
    const both = encodeURIComponent('Drama|Sci-Fi & Fantasy')
    expect(await names(`?genres=${both}&genreMode=all`)).toContain('Severance')
    expect(await names(`?genres=${encodeURIComponent('Drama|Nonexistent')}&genreMode=all`)).toEqual([])
    expect(await names(`?genres=${encodeURIComponent('Drama|Nonexistent')}&genreMode=any`)).toContain('Severance')
    expect(await names(`?genres=${encodeURIComponent('Drama|Drama')}&genreMode=all`)).toContain('Severance')
    // It combines with the text search and the totals agree with the filter.
    expect(await names(`?genres=Drama&q=severance`)).toEqual(['Severance'])
    expect(TitlePage.parse(await get('/library/titles?genres=Nonexistent')).total).toBe(0)
  })

  it('caches artwork on disk once and serves it from the backend', async () => {
    await until('episode stills', async () => (await detail((await byTitle('Severance')).key)).episodes.every((e) => e.stillUrl) || false)
    const files = readdirSync(cacheDir)
    expect(files).toContain('poster-interstellar.png')
    expect(files.filter((f) => f.startsWith('still-')).length).toBe(5)
    const before = fake.imageRequests
    const url = (await byTitle('Interstellar')).posterUrl!
    const res = await fetch(`http://127.0.0.1:${server.port}${url}`, { headers: auth() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(50)
    expect(fake.imageRequests).toBe(before) // served from the cache, not re-downloaded
  })

  it('protects artwork with the API token and refuses odd file names', async () => {
    const url = (await byTitle('Interstellar')).posterUrl!
    expect((await fetch(`http://127.0.0.1:${server.port}${url}`)).status).toBe(401)
    for (const bad of ['..%2F..%2Ftoken', 'poster-..%5Cx.png', 'poster-a.exe', 'x.png', 'poster-a.png%00.exe']) {
      const res = await fetch(`${base}/artwork/${bad}`, { headers: auth() })
      expect([400, 404]).toContain(res.status)
    }
  })

  it('finds a title by the provider name and not only by the file name', async () => {
    // The file says "Zxqv Wplm"; nothing about "Obscure". Identify it, then search the provider name.
    const key = (await byTitle('Zxqv Wplm')).key
    expect((await titles('?q=obscure')).length).toBe(0)
    const res = await send('POST', '/library/title/identify', { key, kind: 'movie', externalId: '700001' })
    expect(res.status).toBe(200)
    expect((await titles('?q=obscure')).map((t) => t.title)).toEqual(['Obscure Gem'])
    expect((await titles('?q=zxqv')).map((t) => t.title)).toEqual(['Obscure Gem']) // the file name still finds it
  })
})

describe('manual identification', () => {
  it('searches the provider for the dialog, with ranking and cached thumbnails', async () => {
    const res = MetadataSearchResult.parse(await get('/metadata/search?kind=series&q=doctor%20who'))
    expect(res.items.map((c) => c.externalId).sort()).toEqual(['1000', '57243'])
    expect(res.items.every((c) => c.posterUrl?.startsWith('/api/v1/artwork/thumb-'))).toBe(true)
    expect(res.items.every((c) => typeof c.score === 'number')).toBe(true)
    expect(res.items.every((c) => c.genres?.includes('Sci-Fi & Fantasy'))).toBe(true)
  })

  it('suggests a year\'s popular movies and series together, rated, with thumbnails', async () => {
    const res = MetadataSuggestionsResult.parse(await get('/metadata/suggestions?section=year&year=2022'))
    expect(res.items.map((c) => [c.kind, c.title])).toEqual([['series', 'Severance']])
    expect(res.items[0]).toMatchObject({ year: 2022, rating: 8.4, score: null, genres: ['Drama', 'Sci-Fi & Fantasy'] })
    expect(res.hasMore).toBe(false)

    const movies = MetadataSuggestionsResult.parse(await get('/metadata/suggestions?section=year&year=2015'))
    expect(movies.items.map((c) => [c.kind, c.title])).toEqual([['movie', 'Mad Max: Fury Road']])
    expect(movies.items.every((c) => c.posterUrl?.startsWith('/api/v1/artwork/thumb-'))).toBe(true)

    const before = fake.requests.length
    expect(MetadataSuggestionsResult.parse(await get('/metadata/suggestions?section=year&year=2015'))).toEqual(movies)
    expect(fake.requests).toHaveLength(before) // the second visit is served from memory
  })

  it('asks for a year when the section needs one, and for nothing new when nothing is new', async () => {
    expect((await send('GET', '/metadata/suggestions?section=year')).status).toBe(400)
    const fresh = MetadataSuggestionsResult.parse(await get('/metadata/suggestions?section=new'))
    expect(fresh).toEqual({ items: [], hasMore: false }) // nothing in the fake data came out in the last weeks
  })

  it('provides the full provider genre catalog, including genres absent from suggestions or the library', async () => {
    const { genres } = GenreList.parse(await get('/metadata/genres'))
    expect(genres).toEqual([...new Set(genres)].sort((a, b) => a.localeCompare(b)))
    expect(genres).toEqual(expect.arrayContaining(['Action', 'Comedy', 'Thriller', 'Sci-Fi & Fantasy']))
  })

  it('separates suggestion caches by genres and mode and normalizes equivalent selections', async () => {
    const query = (genres: string, genreMode = 'any') => `/metadata/suggestions?${new URLSearchParams({ section: 'year', year: '2015', genres, genreMode })}`
    const any = MetadataSuggestionsResult.parse(await get(query('Action|Drama')))
    expect(any.items.map((c) => c.title)).toEqual(['Mad Max: Fury Road'])
    const before = fake.requests.length
    expect(MetadataSuggestionsResult.parse(await get(query(' Drama |Action|Drama')))).toEqual(any)
    expect(fake.requests).toHaveLength(before)
    expect(MetadataSuggestionsResult.parse(await get(query('Action|Drama', 'all')))).toEqual({ items: [], hasMore: false })
    expect(MetadataSuggestionsResult.parse(await get(query('Action|Adventure', 'all'))).items).toHaveLength(1)
    expect(MetadataSuggestionsResult.parse(await get(query('Not a provider genre')))).toEqual({ items: [], hasMore: false })
    expect(MetadataSuggestionsResult.parse(await get('/metadata/suggestions?section=year&year=2015')).items).toHaveLength(1)
    expect((await send('GET', query('Drama', 'invalid'))).status).toBe(400)
    expect((await send('GET', query('x'.repeat(1001)))).status).toBe(400)
  })

  it('gives the IMDb id and trailer of a suggestion on request', async () => {
    expect(MetadataSuggestionDetails.parse(await get('/metadata/suggestions/details?kind=movie&externalId=157336'))).toEqual({
      imdbId: 'tt0816692',
      trailer: { site: 'youtube', key: 'zSWdZVtXT7E' },
    })
    expect(MetadataSuggestionDetails.parse(await get('/metadata/suggestions/details?kind=movie&externalId=700001'))).toEqual({ imdbId: null, trailer: null })
    expect((await send('GET', '/metadata/suggestions/details?kind=movie&externalId=abc')).status).toBe(400)
  })

  it('offers the candidates for an ambiguous title, then locks the user choice', async () => {
    const who = await byTitle('Doctor Who')
    const before = await detail(who.key)
    expect(before.match?.state).toBe('ambiguous')
    expect(before.match?.candidates.map((c) => c.year).sort()).toEqual([1963, 2005])

    const res = await send('POST', '/library/title/identify', { key: who.key, kind: 'series', externalId: '57243' })
    expect(res.status).toBe(200)
    const after = TitleDetail.parse(await res.json())
    expect(after.match).toMatchObject({ state: 'matched', decidedBy: 'user', locked: true, externalId: '57243' })
    expect(after.metadata?.year).toBe(2005)
    expect(after.episodes[0]?.name).toBe('Rose')
  })

  it('a locked match survives a rescan and a refresh', async () => {
    const who = (await titles('?kind=series&limit=200')).find((t) => t.year === 2005)!
    const sources = (await get('/library/sources')) as { items: { id: number; path: string }[] }
    await send('POST', `/library/sources/${sources.items[0]!.id}/scan`)
    await until('rescan', async () => !LibraryStatus.parse(await get('/library/status')).scanning)
    await settled()
    const d = await detail(who.key)
    expect(d.match).toMatchObject({ state: 'matched', decidedBy: 'user', locked: true, externalId: '57243' })
    const refreshed = await send('POST', '/library/title/refresh', { key: who.key })
    expect(refreshed.status).toBe(200)
    expect(TitleDetail.parse(await refreshed.json()).match).toMatchObject({ decidedBy: 'user', locked: true })
  })

  it('rejects the wrong kind, unknown titles and unknown provider ids', async () => {
    const who = (await titles('?kind=series&limit=200')).find((t) => t.year === 2005)!
    expect((await send('POST', '/library/title/identify', { key: who.key, kind: 'movie', externalId: '438631' })).status).toBe(400)
    expect((await send('POST', '/library/title/identify', { key: 'series:nothing', kind: 'series', externalId: '1' })).status).toBe(404)
    expect((await send('POST', '/library/title/identify', { key: who.key, kind: 'series', externalId: '999999999' })).status).toBe(404)
    const trip = await byTitle('Trip to Crete')
    expect((await send('POST', '/library/title/identify', { key: trip.key, kind: 'movie', externalId: '438631' })).status).toBe(400)
    expect((await send('POST', '/library/title/clear-match', { key: trip.key })).status).toBe(400)
  })

  it('clears a match, stops looking, and unlock lets automatic matching try again', async () => {
    const interstellar = await byTitle('Interstellar')
    let res = TitleDetail.parse(await (await send('POST', '/library/title/clear-match', { key: interstellar.key })).json())
    expect(res.match).toMatchObject({ state: 'unmatched', decidedBy: 'user', locked: true })
    expect(res.metadata).toBeNull()
    expect(res.summary.title).toBe('Interstellar') // back to the name from the file
    expect(res.summary.posterUrl).toBeNull()
    await settled()
    expect((await detail(interstellar.key)).match?.state).toBe('unmatched') // not retried while locked

    res = TitleDetail.parse(await (await send('POST', '/library/title/unlock', { key: interstellar.key })).json())
    await until('re-identification', async () => (await detail(interstellar.key)).match?.state === 'matched')
    expect((await detail(interstellar.key)).match).toMatchObject({ decidedBy: 'auto', locked: false })
  })
})

describe('metadata language', () => {
  it('re-fetches matched titles in the new language, falling back per field, and search follows', async () => {
    await send('PUT', '/settings', { metadataLanguage: 'el' })
    await until('Greek titles', async () => (await titles('?q=parasite')).some((t) => t.title === 'Παράσιτο'))
    const parasite = await byTitle('Παράσιτο')
    const d = await detail(parasite.key)
    expect(d.metadata).toMatchObject({ language: 'el', originalTitle: '기생충' })
    expect(d.metadata?.overview).toContain('οικογένεια')
    // English overview fills a field the provider has no Greek value for.
    const interstellar = await detail((await byTitle('Interstellar')).key)
    expect(interstellar.metadata?.overview).toBe('A team of explorers travel through a wormhole in space.')
    expect((await titles('?q=%CE%A0%CE%91%CE%A1%CE%91%CE%A3%CE%99%CE%A4%CE%9F')).map((t) => t.title)).toEqual(['Παράσιτο'])
    await send('PUT', '/settings', { metadataLanguage: 'en' })
    await until('English again', async () => (await titles('?q=parasite')).some((t) => t.title === 'Parasite'))
  })
})

describe('when the provider is not reachable', () => {
  it('keeps the library browsable, reports the state, and recovers on retry', async () => {
    const before = await titles('?limit=200')
    fake.mode = 'down'
    writeFileSync(join(media, 'Dune.2021.2160p.mkv'), 'x')
    await send('POST', '/library/sources/1/scan')
    const s = await until('unavailable', async () => {
      const st = await status()
      return st.state === 'unavailable' ? st : false
    }, 30_000)
    expect(s.pending).toBe(1)
    expect(s.message).toBeTruthy()
    // Everything already known is still there, including posters from the cache.
    const during = await titles('?limit=200')
    expect(during.length).toBe(before.length + 1)
    expect(during.find((t) => t.title === 'Interstellar')?.posterUrl).toBeTruthy()
    expect(during.find((t) => t.title === 'Dune')).toMatchObject({ matchState: null })

    fake.mode = 'ok'
    await send('POST', '/metadata/retry')
    await settled()
    expect(await byTitle('Dune')).toMatchObject({ matchState: 'matched', year: 2021 })
  }, 60_000)
})

describe('secrets', () => {
  it('never writes the key to the logs', () => {
    const logs = join(dir, 'data', 'logs')
    const text = readdirSync(logs)
      .map((f) => readFileSync(join(logs, f), 'utf8'))
      .join(' ')
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toContain(GOOD_KEY)
  })
})

describe('removing the key', () => {
  it('goes back to "no key" but keeps everything already fetched', async () => {
    const res = await send('PUT', '/metadata/credentials', { tmdbApiKey: null })
    expect(res.status).toBe(200)
    expect(MetadataStatus.parse(await res.json())).toMatchObject({ configured: false, state: 'no_key' })
    expect((await byTitle('Severance')).matchState).toBe('matched')
  })
})
