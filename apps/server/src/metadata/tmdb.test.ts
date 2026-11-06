import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GOOD_KEY, GOOD_TOKEN, startFakeTmdb, type FakeTmdb } from '../../../../tools/fake-tmdb/server.mjs'
import { ResilientHttp } from './http'
import { ProviderError } from './provider'
import { TmdbProvider } from './tmdb'

let fake: FakeTmdb
beforeAll(async () => {
  fake = await startFakeTmdb()
})
afterAll(() => fake.close())
beforeEach(() => {
  fake.mode = 'ok'
  fake.requests.length = 0
})

const fast = () =>
  new ResilientHttp({ minIntervalMs: 0, baseDelayMs: 1, sleep: async () => undefined, breakerThreshold: 2, breakerCooldownMs: 1000 })
const provider = (key: string | null = GOOD_KEY, http = fast()) =>
  new TmdbProvider({ credential: () => key, apiBase: fake.url, imageBase: fake.imageUrl, http })

describe('TmdbProvider', () => {
  it('returns only the selected person’s credits in the selected role', async () => {
    const p = provider()
    const movie = await p.fetchTitle('movie', '157336', 'en-US')
    const series = await p.fetchTitle('series', '95396', 'en-US')
    const movieActor = movie.cast[0]!.externalId
    const seriesActor = series.cast[0]!.externalId
    const director = movie.directors[0]!.externalId
    expect((await p.personTitles(movieActor, 'actor', 'en-US')).map((c) => c.title)).toEqual(['Interstellar'])
    expect((await p.personTitles(seriesActor, 'actor', 'en-US')).map((c) => c.title)).toEqual(['Severance'])
    expect((await p.personTitles(director, 'director', 'en-US')).map((c) => c.title)).toEqual(['Interstellar'])
    expect(await p.personTitles(director, 'actor', 'en-US')).toEqual([])
    expect(await p.personTitles(movieActor, 'director', 'en-US')).toEqual([])
    expect(fake.requests.filter((r) => r.path.startsWith('/discover/'))).toEqual([])
    p.close()
  })

  it.each(['actor', 'director'] as const)('gets the top movies and series for a %s, filtering invalid and duplicate credits', async (category) => {
    const p = provider()
    const items = await p.personTitles('42', category, 'en-US')
    expect(items).toHaveLength(20)
    expect(items.filter((c) => c.kind === 'movie').map((c) => c.externalId)).toEqual(Array.from({ length: 10 }, (_, i) => String(8000 + i)))
    expect(items.filter((c) => c.kind === 'series').map((c) => c.externalId)).toEqual(Array.from({ length: 10 }, (_, i) => String(9000 + i)))
    expect(items[0]).toMatchObject({ title: 'Movie 0', year: 2020, rating: 7.5, posterPath: null })
    expect(items[10]).toMatchObject({ title: 'Series 0', year: 2021, rating: null })
    expect((await p.personTitles('42', category, 'el-GR'))[0]?.title).toBe('Ταινία 0')
    expect(fake.requests[0]).toMatchObject({ path: '/person/42/combined_credits', query: { language: 'en-US' } })
    expect(await p.personTitles('0', category, 'en-US')).toEqual([])
    p.close()
  })

  it('searches movies and series with year filters', async () => {
    const p = provider()
    const dunes = await p.search({ kind: 'movie', title: 'dune', language: 'en-US' })
    expect(dunes.map((d) => d.year).sort()).toEqual([1984, 2021, 2024])
    expect(await p.search({ kind: 'movie', title: 'dune', year: 2021, language: 'en-US' })).toHaveLength(1)
    const shows = await p.search({ kind: 'series', title: 'severance', language: 'en-US' })
    expect(shows[0]).toMatchObject({ externalId: '95396', title: 'Severance', year: 2022, kind: 'series' })
    expect(dunes[0]?.genres).toContain('Science Fiction')
    expect(shows[0]?.genres).toEqual(['Drama', 'Sci-Fi & Fantasy'])
  })

  it('suggests a page of movies and series, alternating and rated, from the right slice of the provider\'s list', async () => {
    const p = provider()
    const year = await p.suggestions({ section: 'year', year: 2017, page: 1, language: 'en-US', today: '2026-10-24' })
    expect(year.items.map((c) => [c.kind, c.title, c.rating])).toEqual([['series', 'Dark', 8.4]])
    expect(year.hasMore).toBe(false)
    expect(year.items[0]?.genres).toEqual(['Drama'])
    expect(fake.requests.map((r) => r.path).sort()).toEqual(['/discover/movie', '/discover/tv', '/genre/tv/list'])
    expect(fake.requests[0]?.query).toMatchObject({ primary_release_year: '2017', 'vote_count.gte': '100', sort_by: 'popularity.desc', page: '1' })

    // Our page 2 is the second half of TMDB's page 1; the fake's lists are short, so it is empty and the end.
    fake.requests.length = 0
    const second = await p.suggestions({ section: 'year', year: 2017, page: 2, language: 'en-US', today: '2026-10-24' })
    expect(second).toEqual({ items: [], hasMore: false })
    expect(fake.requests[0]?.query.page).toBe('1')
    fake.requests.length = 0
    await p.suggestions({ section: 'year', year: 2017, page: 3, language: 'en-US', today: '2026-10-24' })
    expect(fake.requests[0]?.query.page).toBe('2')
  })

  it('suggests what is new from a window of weeks before today', async () => {
    const p = provider()
    const fresh = await p.suggestions({ section: 'new', page: 1, language: 'en-US', today: '2022-03-01' })
    expect(fresh.items.map((c) => c.title)).toEqual(['Severance'])
    const movieCall = fake.requests.find((r) => r.path === '/discover/movie')
    expect(movieCall?.query).toMatchObject({ 'primary_release_date.gte': '2021-12-31', 'primary_release_date.lte': '2022-03-01' })
  })

  it('sends rating bounds for both kinds, excludes unrated titles and preserves yearly vote thresholds', async () => {
    const p = provider()
    const query = { section: 'year' as const, year: 2017, page: 1, language: 'en-US', today: '2026-10-24' }
    const exact = await p.suggestions({ ...query, ratingMin: 8.4, ratingMax: 8.4 })
    expect(exact.items.map(c => c.title)).toEqual(['Dark'])
    for (const call of fake.requests.filter(r => r.path.startsWith('/discover/'))) {
      expect(call.query).toMatchObject({ 'vote_average.gte': '8.4', 'vote_average.lte': '8.4', 'vote_count.gte': '100' })
    }
    expect((await p.suggestions({ ...query, ratingMax: 8.3 })).items).toEqual([])
    fake.requests.length = 0
    await p.suggestions({ ...query, section: 'new', ratingMax: 9 })
    for (const call of fake.requests.filter(r => r.path.startsWith('/discover/'))) expect(call.query['vote_count.gte']).toBe('1')
    p.close()
  })

  it('lists the complete, sorted movie and TV genre catalog and reuses language-specific lists', async () => {
    const p = provider()
    const genres = await p.genres('en-US')
    expect(genres).toContain('Action')
    expect(genres).toContain('Sci-Fi & Fantasy')
    expect(genres).toEqual([...new Set(genres)].sort((a, b) => a.localeCompare(b)))
    expect(fake.requests.map((r) => r.path).sort()).toEqual(['/genre/movie/list', '/genre/tv/list'])
    await p.genres('en-US')
    expect(fake.requests).toHaveLength(2)
    await p.genres('el-GR')
    expect(fake.requests.slice(2).every((r) => r.query.language === 'el-GR')).toBe(true)
    expect(fake.requests).toHaveLength(4)
  })

  it('lists only the genres of the asked kind, since TV-only ones such as "Action & Adventure" match no movie', async () => {
    const p = provider()
    const movies = await p.genres('en-US', 'movie')
    const series = await p.genres('en-US', 'series')
    expect(movies).toContain('Action')
    expect(movies).not.toContain('Sci-Fi & Fantasy')
    expect(series).toContain('Sci-Fi & Fantasy')
    expect(series).not.toContain('Science Fiction')
  })

  it('applies Any and All genres to discovery and skips media kinds that cannot match', async () => {
    const p = provider()
    const query = { section: 'year' as const, year: 2015, page: 1, language: 'en-US', today: '2026-10-24' }
    const any = await p.suggestions({ ...query, genres: ['Action', 'Drama'] })
    expect(any.items.map((c) => c.title)).toEqual(['Mad Max: Fury Road'])
    expect(fake.requests.find((r) => r.path === '/discover/movie')?.query.with_genres).toMatch(/^\d+\|\d+$/)
    // Drama exists for TV, but Action does not. Any can still discover Drama series.
    expect(fake.requests.find((r) => r.path === '/discover/tv')?.query.with_genres).toMatch(/^\d+$/)

    fake.requests.length = 0
    expect(await p.suggestions({ ...query, genres: ['Action', 'Drama'], genreMode: 'all' })).toEqual({ items: [], hasMore: false })
    expect(fake.requests.map((r) => r.path)).toEqual(['/discover/movie'])
    expect(fake.requests[0]?.query.with_genres).toMatch(/^\d+,\d+$/)
    expect((await p.suggestions({ ...query, genres: ['Action', 'Adventure'], genreMode: 'all' })).items).toHaveLength(1)

    fake.requests.length = 0
    expect(await p.suggestions({ ...query, genres: ['Not a provider genre'] })).toEqual({ items: [], hasMore: false })
    expect(fake.requests).toHaveLength(0)
  })

  it('filters before pagination so genres absent from the original page still fill matching pages', async () => {
    // All 25 Drama titles rank below the first 20 Comedy titles in the unfiltered catalog.
    const catalog = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, title: `Title ${i + 1}`, genre_ids: [i < 20 ? 35 : 18] }))
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/genre/')) return new Response(JSON.stringify({ genres: [{ id: 18, name: 'Drama' }, { id: 35, name: 'Comedy' }] }))
      const filtered = url.searchParams.get('with_genres') === '18' ? catalog.filter((c) => c.genre_ids.includes(18)) : catalog
      const list = url.pathname.endsWith('/tv') ? [] : filtered
      const page = Number(url.searchParams.get('page'))
      return new Response(JSON.stringify({ results: list.slice((page - 1) * 20, page * 20), total_pages: Math.ceil(list.length / 20) }))
    })
    const p = provider(GOOD_KEY, new ResilientHttp({ fetch, minIntervalMs: 0 }))
    const query = { section: 'year' as const, year: 2026, language: 'en-US', today: '2026-10-24' }
    expect((await p.suggestions({ ...query, page: 1 })).items.every((c) => c.genres?.includes('Comedy'))).toBe(true)
    const first = await p.suggestions({ ...query, genres: ['Drama'], page: 1 })
    const second = await p.suggestions({ ...query, genres: ['Drama'], page: 2 })
    const third = await p.suggestions({ ...query, genres: ['Drama'], page: 3 })
    expect(first.items.map((c) => c.externalId)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 21)))
    expect(second.items.map((c) => c.externalId)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 31)))
    expect(third.items.map((c) => c.externalId)).toEqual(Array.from({ length: 5 }, (_, i) => String(i + 41)))
    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false])
  })

  it('filters ratings before pagination so matching titles beyond the original page remain discoverable', async () => {
    const catalog = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, title: `Title ${i + 1}`, vote_average: i < 20 ? 4 : 8, vote_count: 200 }))
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input))
      const min = Number(url.searchParams.get('vote_average.gte') ?? 0)
      const max = Number(url.searchParams.get('vote_average.lte') ?? 10)
      const filtered = catalog.filter(c => c.vote_average >= min && c.vote_average <= max)
      const list = url.pathname.endsWith('/tv') ? [] : filtered
      const page = Number(url.searchParams.get('page'))
      return new Response(JSON.stringify({ results: list.slice((page - 1) * 20, page * 20), total_pages: Math.ceil(list.length / 20) }))
    })
    const p = provider(GOOD_KEY, new ResilientHttp({ fetch, minIntervalMs: 0 }))
    const query = { section: 'year' as const, year: 2026, language: 'en-US', today: '2026-10-24', ratingMin: 7, ratingMax: 9 }
    const pages = await Promise.all([1, 2, 3].map(page => p.suggestions({ ...query, page })))
    expect(pages.flatMap(page => page.items).map(c => c.externalId)).toEqual(Array.from({ length: 25 }, (_, i) => String(i + 21)))
    expect(pages.map(page => page.hasMore)).toEqual([true, true, false])
    p.close()
  })

  it('finds a title by its translated or original name', async () => {
    const p = provider()
    expect((await p.search({ kind: 'movie', title: 'Παράσιτο', language: 'el-GR' }))[0]).toMatchObject({ externalId: '496243' })
    expect((await p.search({ kind: 'movie', title: 'parasite', language: 'el-GR' }))[0]?.originalTitle).toBe('기생충')
  })

  it('reads details with cast, genres, rating and ids', async () => {
    const t = await provider().fetchTitle('movie', '157336', 'en-US')
    expect(t).toMatchObject({
      title: 'Interstellar',
      year: 2014,
      runtimeMinutes: 169,
      imdbId: 'tt0816692',
      trailer: { site: 'youtube', key: 'zSWdZVtXT7E' },
      genres: ['Adventure', 'Drama', 'Science Fiction'],
      rating: { value: 8.4, votes: 35000 },
    })
    expect(t.cast[0]).toMatchObject({ name: 'Matthew McConaughey', character: 'Cooper', profilePath: expect.stringMatching(/^\/person-\d+\.png$/) })
    expect(t.cast[1]?.profilePath).toBeNull()
    expect(t.directors[0]).toMatchObject({ name: 'Christopher Nolan', profilePath: expect.stringMatching(/^\/person-\d+\.png$/) })
    expect(fake.requests.at(-1)?.query).toMatchObject({ append_to_response: 'credits,external_ids,videos', include_video_language: 'en,null' })
  })

  it('fills fields missing in Greek from English, per field, and keeps Greek names', async () => {
    const t = await provider().fetchTitle('movie', '157336', 'el-GR')
    expect(t.overview).toBe('A team of explorers travel through a wormhole in space.')
    const parasite = await provider().fetchTitle('movie', '496243', 'el-GR')
    expect(parasite.title).toBe('Παράσιτο')
    expect(parasite.overview).toContain('οικογένεια')
    expect(parasite.originalTitle).toBe('기생충')
  })

  it('reads a series with its seasons and episodes', async () => {
    const p = provider()
    const show = await p.fetchTitle('series', '95396', 'en-US')
    expect(show).toMatchObject({ title: 'Severance', year: 2022, runtimeMinutes: 50, imdbId: 'tt11280740', trailer: { site: 'youtube', key: 'xEQP4VVuyrY' }, seasons: [1, 2] })
    const s1 = await p.fetchSeason('95396', 1, 'en-US')
    expect(s1.map((e) => e.name)).toEqual(['Good News About Hell', 'Half Loop', 'In Perpetuity'])
    expect(s1[0]).toMatchObject({ season: 1, episode: 1, airDate: '2022-02-18', runtimeMinutes: 50 })
  })

  it('accepts both a v3 key (query) and a v4 token (Authorization header)', async () => {
    await provider(GOOD_KEY).validate()
    expect(fake.requests.at(-1)?.query.api_key).toBe(GOOD_KEY)
    await provider(GOOD_TOKEN).validate()
    expect(fake.requests.at(-1)?.auth).toBe(GOOD_TOKEN)
    expect(fake.requests.at(-1)?.query.api_key).toBeUndefined()
  })

  it('reports a rejected or missing key as an auth error, without retrying', async () => {
    await expect(provider('wrong-key-wrong-key-wrong-key-123').validate()).rejects.toMatchObject({ kind: 'auth' })
    expect(fake.requests).toHaveLength(1)
    await expect(provider(null).validate()).rejects.toMatchObject({ kind: 'auth' })
  })

  it('reports an unknown id as not_found', async () => {
    await expect(provider().fetchTitle('movie', '1', 'en-US')).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('builds image URLs by purpose', () => {
    const p = provider()
    expect(p.imageUrl('/a.png', 'poster')).toBe(`${fake.imageUrl}/w500/a.png`)
    expect(p.imageUrl('/a.png', 'thumb')).toBe(`${fake.imageUrl}/w185/a.png`)
    expect(p.imageUrl('/a.png', 'backdrop')).toBe(`${fake.imageUrl}/w1280/a.png`)
  })
})

describe('ResilientHttp', () => {
  const url = () => new URL(`${fake.url}/configuration?api_key=${GOOD_KEY}`)

  it('retries server errors and then reports the provider as unavailable', async () => {
    fake.mode = 'down'
    await expect(fast().getJson(url())).rejects.toMatchObject({ kind: 'unavailable' })
    expect(fake.requests).toHaveLength(4) // first try + 3 retries
  })

  it('waits out rate limiting and succeeds once the provider recovers', async () => {
    fake.mode = 'rate'
    let sleeps = 0
    const http = new ResilientHttp({
      minIntervalMs: 0,
      baseDelayMs: 1,
      sleep: async () => {
        // The first back-off is when the provider "recovers".
        if (sleeps++ === 0) fake.mode = 'ok'
      },
    })
    await expect(http.getJson(url())).resolves.toBeTruthy()
    expect(fake.requests).toHaveLength(2)
  })

  it('treats a dropped connection like any other transient failure', async () => {
    fake.mode = 'dead'
    await expect(fast().getJson(url())).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('opens a circuit breaker after repeated failures, then closes it after the cool-down', async () => {
    fake.mode = 'down'
    let clock = 0
    const http = new ResilientHttp({
      minIntervalMs: 0,
      baseDelayMs: 1,
      maxRetries: 0,
      sleep: async () => undefined,
      breakerThreshold: 2,
      breakerCooldownMs: 1000,
      now: () => clock,
    })
    await expect(http.getJson(url())).rejects.toBeInstanceOf(ProviderError)
    await expect(http.getJson(url())).rejects.toBeInstanceOf(ProviderError)
    expect(http.isOpen).toBe(true)
    const before = fake.requests.length
    await expect(http.getJson(url())).rejects.toMatchObject({ message: expect.stringContaining('paused') })
    expect(fake.requests.length).toBe(before) // no request was made while open
    fake.mode = 'ok'
    clock = 1500
    await expect(http.getJson(url())).resolves.toBeTruthy()
    expect(http.isOpen).toBe(false)
  })

  it('can be reset by hand (new credentials, "try again")', async () => {
    fake.mode = 'down'
    const http = new ResilientHttp({ minIntervalMs: 0, maxRetries: 0, sleep: async () => undefined, breakerThreshold: 1 })
    await expect(http.getJson(url())).rejects.toBeInstanceOf(ProviderError)
    expect(http.isOpen).toBe(true)
    http.reset()
    expect(http.isOpen).toBe(false)
  })

  it('stops at once when closed, and refuses further calls', async () => {
    const http = fast()
    http.close()
    await expect(http.getJson(url())).rejects.toMatchObject({ kind: 'unavailable' })
    expect(fake.requests).toHaveLength(0)
  })

  it('does not count a rejected key towards the breaker', async () => {
    const http = new ResilientHttp({ minIntervalMs: 0, maxRetries: 0, sleep: async () => undefined, breakerThreshold: 1 })
    await expect(http.getJson(new URL(`${fake.url}/configuration?api_key=bad`))).rejects.toMatchObject({ kind: 'auth' })
    expect(http.isOpen).toBe(false)
  })

  it('refuses images above the size limit', async () => {
    const http = fast()
    await expect(http.getBytes(new URL(`${fake.imageUrl}/w500/x.png`), 10)).rejects.toMatchObject({ kind: 'unavailable' })
    const ok = await http.getBytes(new URL(`${fake.imageUrl}/w500/x.png`), 10_000)
    expect(ok.contentType).toBe('image/png')
  })
})
