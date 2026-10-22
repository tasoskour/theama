import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
  it('searches movies and series with year filters', async () => {
    const p = provider()
    const dunes = await p.search({ kind: 'movie', title: 'dune', language: 'en-US' })
    expect(dunes.map((d) => d.year).sort()).toEqual([1984, 2021, 2024])
    expect(await p.search({ kind: 'movie', title: 'dune', year: 2021, language: 'en-US' })).toHaveLength(1)
    const shows = await p.search({ kind: 'series', title: 'severance', language: 'en-US' })
    expect(shows[0]).toMatchObject({ externalId: '95396', title: 'Severance', year: 2022, kind: 'series' })
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
    expect(t.cast[0]).toMatchObject({ name: 'Matthew McConaughey', character: 'Cooper' })
    expect(t.directors[0]).toMatchObject({ name: 'Christopher Nolan' })
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
