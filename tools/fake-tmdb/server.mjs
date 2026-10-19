// A tiny stand-in for the parts of the TMDB API that Theama uses, for automated tests only.
// It speaks the same JSON shapes as https://developer.themoviedb.org/reference, serves one-pixel
// images, and can be told to fail, so matching, caching and error handling are tested without a key.
import { createServer } from 'node:http'

export const GOOD_KEY = 'good-key-0123456789abcdef0123456789ab'
export const GOOD_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0In0.signature'

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** @type {Record<string, any>[]} */
const MOVIES = [
  { id: 157336, title: 'Interstellar', original_title: 'Interstellar', release_date: '2014-11-05', runtime: 169, popularity: 140, vote_average: 8.4, vote_count: 35000, poster_path: '/interstellar.png', backdrop_path: '/interstellar-bg.png', imdb_id: 'tt0816692', genres: ['Adventure', 'Drama', 'Science Fiction'], tagline: 'Mankind was born on Earth. It was never meant to die here.', overview: 'A team of explorers travel through a wormhole in space.', cast: [['Matthew McConaughey', 'Cooper'], ['Anne Hathaway', 'Brand']], el: { overview: '', tagline: '', title: 'Interstellar' } },
  { id: 841, title: 'Dune', original_title: 'Dune', release_date: '1984-12-14', runtime: 137, popularity: 30, vote_average: 6.1, vote_count: 1900, poster_path: '/dune84.png', imdb_id: 'tt0087182', genres: ['Science Fiction'], overview: 'A Duke’s son leads desert warriors.' },
  { id: 438631, title: 'Dune', original_title: 'Dune', release_date: '2021-09-15', runtime: 155, popularity: 100, vote_average: 7.8, vote_count: 11000, poster_path: '/dune21.png', imdb_id: 'tt1160419', genres: ['Science Fiction', 'Adventure'], overview: 'Paul Atreides travels to the dangerous planet Arrakis.' },
  { id: 693134, title: 'Dune: Part Two', original_title: 'Dune: Part Two', release_date: '2024-02-27', runtime: 167, popularity: 150, vote_average: 8.2, vote_count: 6000, poster_path: '/dune2.png', genres: ['Science Fiction'], overview: 'Paul Atreides unites with the Fremen.' },
  { id: 496243, title: 'Parasite', original_title: '기생충', release_date: '2019-05-30', runtime: 133, popularity: 80, vote_average: 8.5, vote_count: 18000, poster_path: '/parasite.png', genres: ['Comedy', 'Thriller', 'Drama'], overview: 'All unemployed, Ki-taek’s family takes peculiar interest in the wealthy Parks.', el: { title: 'Παράσιτο', overview: 'Μια φτωχή οικογένεια παρεισφρέει στους πλούσιους Παρκ.', tagline: '', genres: ['Κωμωδία', 'Θρίλερ', 'Δράμα'] } },
  { id: 9659, title: 'Mad Max', original_title: 'Mad Max', release_date: '1979-04-12', runtime: 95, popularity: 40, vote_average: 6.7, vote_count: 4000, poster_path: '/madmax.png', genres: ['Action'], overview: 'A highway patrolman vows revenge.', collection: 8945 },
  { id: 8810, title: 'Mad Max 2', original_title: 'Mad Max 2', release_date: '1981-12-24', runtime: 96, popularity: 38, vote_average: 7.0, vote_count: 3500, poster_path: '/madmax2.png', genres: ['Action'], overview: 'The Road Warrior.', collection: 8945 },
  { id: 9361, title: 'Mad Max Beyond Thunderdome', original_title: 'Mad Max Beyond Thunderdome', release_date: '1985-07-10', runtime: 107, popularity: 36, vote_average: 6.1, vote_count: 2800, poster_path: null, genres: ['Action'], overview: 'Max drifts into Bartertown.', collection: 8945 },
  { id: 76341, title: 'Mad Max: Fury Road', original_title: 'Mad Max: Fury Road', release_date: '2015-05-13', runtime: 120, popularity: 110, vote_average: 7.6, vote_count: 22000, poster_path: '/furyroad.png', genres: ['Action', 'Adventure'], overview: 'Max joins Furiosa across the wasteland.', collection: 8945 },
  { id: 700001, title: 'Obscure Gem', original_title: 'Obscure Gem', release_date: '2001-01-01', runtime: 90, popularity: 1, poster_path: null, genres: [], overview: '' },
]

/** Official collections, as TMDB publishes them. */
const COLLECTIONS = {
  8945: { id: 8945, name: 'Mad Max Collection', overview: 'Max Rockatansky in the wasteland.', poster_path: '/madmax-collection.png', backdrop_path: null, el: { name: 'Συλλογή Mad Max', overview: '' } },
}

/** @type {Record<string, any>[]} */
const SHOWS = [
  { id: 95396, name: 'Severance', original_name: 'Severance', first_air_date: '2022-02-17', episode_run_time: [50], popularity: 160, vote_average: 8.4, vote_count: 3000, poster_path: '/severance.png', backdrop_path: '/severance-bg.png', genres: ['Drama', 'Sci-Fi & Fantasy'], tagline: 'Work-life balance, redefined.', overview: 'Mark leads a team of office workers whose memories have been surgically divided.', status: 'Returning Series', cast: [['Adam Scott', 'Mark Scout']], seasons: { 1: [['Good News About Hell', '2022-02-18'], ['Half Loop', '2022-02-18'], ['In Perpetuity', '2022-02-18']], 2: [['Hello, Ms. Cobel', '2025-01-17'], ['The Future Episode', '2099-01-01']] } },
  { id: 70523, name: 'Dark', original_name: 'Dark', first_air_date: '2017-12-01', episode_run_time: [60], popularity: 90, vote_average: 8.4, vote_count: 5000, poster_path: '/dark.png', genres: ['Drama'], overview: 'A missing child sets four families on a frantic hunt.', seasons: { 1: [['Secrets', '2017-12-01'], ['Lies', '2017-12-01']] } },
  { id: 1000, name: 'Doctor Who', original_name: 'Doctor Who', first_air_date: '1963-11-23', episode_run_time: [25], popularity: 40, vote_average: 7.4, vote_count: 2400, poster_path: '/dw63.png', genres: ['Sci-Fi & Fantasy'], overview: 'The original series.', seasons: { 1: [['An Unearthly Child', '1963-11-23']] } },
  { id: 57243, name: 'Doctor Who', original_name: 'Doctor Who', first_air_date: '2005-03-26', episode_run_time: [45], popularity: 120, vote_average: 7.5, vote_count: 3000, poster_path: '/dw05.png', genres: ['Sci-Fi & Fantasy'], overview: 'The revived series.', seasons: { 1: [['Rose', '2005-03-26']] } },
  { id: 61000, name: 'Μια Σειρά', original_name: 'Μια Σειρά', first_air_date: '2010-01-01', episode_run_time: [40], popularity: 5, poster_path: '/seira.png', genres: ['Drama'], overview: 'Ελληνική σειρά.', seasons: { 1: [['Πρώτο', '2010-01-01']] } },
]

function matches(query, ...names) {
  const words = fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const hay = fold(names.filter(Boolean).join(' '))
  return words.length > 0 && words.every((w) => hay.includes(w))
}

/**
 * @param {{ port?: number }} [options]
 * Control the fake from a test through the returned object: `mode` makes every API call fail
 * ('down' = HTTP 500, 'rate' = 429 with Retry-After: 0, 'dead' = connection dropped), `requests` records calls.
 */
export async function startFakeTmdb(options = {}) {
  const state = {
    /** @type {'ok' | 'down' | 'rate' | 'dead'} */
    mode: 'ok',
    requests: /** @type {{ path: string, query: Record<string, string>, auth: string | null }[]} */ ([]),
    imageRequests: 0,
    url: '',
    imageUrl: '',
    close: () => Promise.resolve(),
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const json = (code, body, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }

    if (url.pathname.startsWith('/t/p/')) {
      state.imageRequests++
      if (state.mode === 'dead') return req.socket.destroy()
      if (state.mode === 'down') return json(500, {})
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(PNG)
    }

    const query = Object.fromEntries(url.searchParams)
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') ?? null
    state.requests.push({ path: url.pathname, query, auth: bearer })
    if (state.mode === 'dead') return req.socket.destroy()
    if (state.mode === 'down') return json(500, { status_message: 'Internal error' })
    if (state.mode === 'rate') return json(429, { status_message: 'Too many requests' }, { 'Retry-After': '0' })
    if (!(query.api_key === GOOD_KEY || bearer === GOOD_TOKEN)) return json(401, { status_code: 7, status_message: 'Invalid API key' })

    const lang = (query.language ?? 'en-US').slice(0, 2)
    const path = url.pathname

    if (path === '/configuration') return json(200, { images: { base_url: 'http://image/' } })

    const pick = (item, key, fallback) => (lang === 'el' && item.el && key in item.el ? item.el[key] : fallback)

    if (path === '/search/movie' || path === '/search/tv') {
      const tv = path === '/search/tv'
      const year = query.year ?? query.first_air_date_year
      const list = (tv ? SHOWS : MOVIES).filter((x) => {
        const yearOf = (tv ? x.first_air_date : x.release_date).slice(0, 4)
        if (year && yearOf !== year) return false
        return matches(query.query ?? '', x.title ?? x.name, x.original_title ?? x.original_name, x.el?.title)
      })
      return json(200, {
        page: 1,
        results: list.map((x) => ({
          id: x.id,
          [tv ? 'name' : 'title']: pick(x, 'title', x.title ?? x.name),
          [tv ? 'original_name' : 'original_title']: x.original_title ?? x.original_name,
          [tv ? 'first_air_date' : 'release_date']: tv ? x.first_air_date : x.release_date,
          overview: pick(x, 'overview', x.overview),
          poster_path: x.poster_path,
          popularity: x.popularity,
        })),
      })
    }

    const movie = path.match(/^\/movie\/(\d+)$/)
    if (movie) {
      const m = MOVIES.find((x) => String(x.id) === movie[1])
      if (!m) return json(404, { status_code: 34 })
      return json(200, {
        id: m.id,
        title: pick(m, 'title', m.title),
        original_title: m.original_title,
        release_date: m.release_date,
        tagline: pick(m, 'tagline', m.tagline ?? ''),
        overview: pick(m, 'overview', m.overview ?? ''),
        runtime: m.runtime,
        genres: (pick(m, 'genres', m.genres) ?? []).map((name) => ({ name })),
        vote_average: m.vote_average ?? null,
        vote_count: m.vote_count ?? 0,
        poster_path: m.poster_path,
        backdrop_path: m.backdrop_path ?? null,
        imdb_id: m.imdb_id ?? null,
        status: 'Released',
        credits: { cast: (m.cast ?? []).map(([name, character], order) => ({ name, character, order })) },
        external_ids: { imdb_id: m.imdb_id ?? null },
        belongs_to_collection: m.collection ? { id: m.collection, name: COLLECTIONS[m.collection].name } : null,
      })
    }

    const coll = path.match(/^\/collection\/(\d+)$/)
    if (coll) {
      const c = COLLECTIONS[coll[1]]
      if (!c) return json(404, { status_code: 34 })
      const parts = MOVIES.filter((m) => m.collection === c.id).sort((a, b) => a.release_date.localeCompare(b.release_date))
      return json(200, {
        id: c.id,
        name: lang === 'el' ? c.el.name : c.name,
        overview: lang === 'el' ? c.el.overview : c.overview,
        poster_path: c.poster_path,
        backdrop_path: c.backdrop_path,
        parts: parts.map((m) => ({ id: m.id, title: m.title, release_date: m.release_date, overview: m.overview, poster_path: m.poster_path })),
      })
    }

    const show = path.match(/^\/tv\/(\d+)$/)
    if (show) {
      const s = SHOWS.find((x) => String(x.id) === show[1])
      if (!s) return json(404, { status_code: 34 })
      return json(200, {
        id: s.id,
        name: s.name,
        original_name: s.original_name,
        first_air_date: s.first_air_date,
        tagline: s.tagline ?? '',
        overview: s.overview ?? '',
        episode_run_time: s.episode_run_time,
        genres: s.genres.map((name) => ({ name })),
        vote_average: s.vote_average ?? null,
        vote_count: s.vote_count ?? 0,
        poster_path: s.poster_path,
        backdrop_path: s.backdrop_path ?? null,
        status: s.status ?? 'Ended',
        credits: { cast: (s.cast ?? []).map(([name, character], order) => ({ name, character, order })) },
        external_ids: { imdb_id: null },
        seasons: Object.keys(s.seasons).map((n) => ({ season_number: Number(n) })),
      })
    }

    const season = path.match(/^\/tv\/(\d+)\/season\/(\d+)$/)
    if (season) {
      const s = SHOWS.find((x) => String(x.id) === season[1])
      const eps = s?.seasons[Number(season[2])]
      if (!s || !eps) return json(404, { status_code: 34 })
      return json(200, {
        episodes: eps.map(([name, air], i) => ({
          episode_number: i + 1,
          name,
          overview: `${name} overview`,
          air_date: air,
          runtime: s.episode_run_time[0],
          still_path: `/still-${s.id}-${season[2]}-${i + 1}.png`,
        })),
      })
    }

    return json(404, { status_code: 34, status_message: 'Not found' })
  })

  await new Promise((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  state.url = `http://127.0.0.1:${port}`
  state.imageUrl = `http://127.0.0.1:${port}/t/p`
  state.close = () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve(undefined)) })
  return state
}

// `node tools/fake-tmdb/server.mjs` runs it by hand, e.g. to try the app without a TMDB key.
if (/fake-tmdb[/\\]server\.mjs$/.test(process.argv[1] ?? '')) {
  const fake = await startFakeTmdb({ port: Number(process.env.PORT ?? 47999) })
  console.log(`Fake TMDB on ${fake.url}\nKey: ${GOOD_KEY}\nStart Theama with THEAMA_TMDB_API_BASE=${fake.url} THEAMA_TMDB_IMAGE_BASE=${fake.imageUrl}`)
}
