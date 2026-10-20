import { join } from 'node:path'
import { openDatabase } from '../../apps/server/src/db/client'
import { LibrarySourceRepo } from '../../apps/server/src/library/sources'
import { titleKeyFor } from '../../apps/server/src/scan/filename'
import { MediaFileRepo, type NewFileRow } from '../../apps/server/src/scan/store'

export interface Sizes {
  movies: number
  series: number
  episodesPerSeries: number
  videos: number
}
export const FULL: Sizes = { movies: 3800, series: 1000, episodesPerSeries: 16, videos: 200 }
export const SMALL: Sizes = { movies: 400, series: 60, episodesPerSeries: 8, videos: 20 }

const ADJECTIVES = ['Silent', 'Golden', 'Broken', 'Hidden', 'Last', 'Midnight', 'Electric', 'Frozen', 'Crimson', 'Lost', 'Wild', 'Quiet', 'Burning', 'Hollow', 'Distant', 'Ancient', 'Neon', 'Velvet', 'Iron', 'Paper']
const NOUNS = ['River', 'Kingdom', 'Letter', 'Harbor', 'Garden', 'Signal', 'Winter', 'Mirror', 'Thunder', 'Empire', 'Orchard', 'Highway', 'Lantern', 'Station', 'Island', 'Promise', 'Shadow', 'Horizon', 'Circus', 'Archive']
const GREEK = ['Ταινία', 'Νύχτα', 'Θάλασσα', 'Δρόμος', 'Αστέρι', 'Σπίτι', 'Καλοκαίρι', 'Ιστορία']

const pick = <T>(list: readonly T[], i: number): T => list[i % list.length]!
function titleOf(i: number): string {
  const base = `${pick(ADJECTIVES, i)} ${pick(NOUNS, Math.floor(i / ADJECTIVES.length))}`
  const round = Math.floor(i / (ADJECTIVES.length * NOUNS.length))
  const name = round > 0 ? `${base} ${round + 1}` : base
  return i % 17 === 0 ? `${pick(GREEK, i)} ${name}` : name
}


/** Fills a new library database with a realistic synthetic library (no files on disk). */
export function seed(dataDir: string, sizes: Sizes): { keys: { series: string; movie: string } } {
  const { movies: MOVIES, series: SERIES, episodesPerSeries: EPISODES_PER_SERIES, videos: VIDEOS } = sizes
  const handle = openDatabase(join(dataDir, 'data', 'theama.db'))
  const library = new LibrarySourceRepo(handle.db)
  const files = new MediaFileRepo(handle.db, handle.raw)
  const sources = [1, 2, 3].map((n) => library.create({ path: `Z:\\Synthetic${n}`, libraryType: 'auto', recursive: true, volumeId: String(n) }).id)
  const rows: NewFileRow[] = []
  const when = (i: number): string => new Date(Date.UTC(2023, 0, 1) + i * 3_600_000).toISOString()
  let n = 0
  const add = (kind: NewFileRow['kind'], title: string, year: number | null, extra: Partial<NewFileRow> = {}): void => {
    n++
    const path = `Z:\\Synthetic${(n % 3) + 1}\\${title.replace(/ /g, '.')}.${n}.mkv`
    rows.push({ sourceId: sources[n % 3]!, path, size: 2_000_000_000 + n, mtimeMs: n, state: 'available', firstSeenAt: when(n), lastSeenAt: when(n), kind, guessedTitle: title, guessedYear: year, season: null, episode: null, episodeEnd: null, episodeTitle: null, titleKey: titleKeyFor(kind, title, year, path), ...extra })
  }
  for (let i = 0; i < MOVIES; i++) add('movie', titleOf(i), 1960 + (i % 65))
  for (let s = 0; s < SERIES; s++) {
    const title = titleOf(MOVIES + s)
    for (let e = 0; e < EPISODES_PER_SERIES; e++) add('episode', title, null, { season: 1 + Math.floor(e / 8), episode: (e % 8) + 1, episodeTitle: `Episode ${e + 1}` })
  }
  for (let v = 0; v < VIDEOS; v++) add('video', `Holiday ${v}`, null)
  for (let i = 0; i < rows.length; i += 1000) files.insertMany(rows.slice(i, i + 1000))

  // Provider data for most titles, episode lists for series, some watched marks and a few collections.
  const keys = (handle.raw.prepare("SELECT DISTINCT title_key AS k, kind FROM media_file WHERE kind IN ('movie','episode')").all() as { k: string; kind: string }[])
  const now = new Date().toISOString()
  handle.raw.transaction(() => {
    const match = handle.raw.prepare("INSERT INTO title_match (title_key, kind, state, provider, external_id, score, decided_by, locked, attempts, attempted_at, updated_at) VALUES (?, ?, 'matched', 'tmdb', ?, 0.95, 'auto', 0, 1, ?, ?)")
    const meta = handle.raw.prepare("INSERT INTO title_metadata (title_key, provider, external_id, language, title, year, overview, genres, rating, votes, poster_file, poster_path, cast_json, fetched_at, version) VALUES (?, 'tmdb', ?, 'en', ?, ?, 'A synthetic overview.', '[]', 7.5, 1000, ?, ?, '[]', ?, 2)")
    const ep = handle.raw.prepare("INSERT INTO episode_metadata (title_key, season, episode, name, air_date) VALUES (?, ?, ?, ?, '2020-01-01')")
    keys.forEach(({ k, kind }, i) => {
      if (i % 7 === 6) return // some titles stay unidentified
      const ext = String(100_000 + i)
      match.run(k, kind === 'episode' ? 'series' : 'movie', ext, now, now)
      meta.run(k, ext, k.split(':')[1] ?? k, 2000 + (i % 24), `poster-${i}.jpg`, `/poster${i}.jpg`, now)
      if (kind === 'episode') for (let e = 0; e < EPISODES_PER_SERIES + 2; e++) ep.run(k, 1 + Math.floor(e / 8), (e % 8) + 1, `Episode ${e + 1}`)
    })
    const played = handle.raw.prepare("INSERT OR IGNORE INTO playback_state (file_id, watched, watched_at, last_played_at, play_count) SELECT id, 1, ?, ?, 1 FROM media_file WHERE id % 9 = 0")
    played.run(now, now)
    for (let c = 0; c < 40; c++) {
      const id = Number(handle.raw.prepare("INSERT INTO collection (kind, provider, external_id, name, created_at, updated_at) VALUES ('official', 'tmdb', ?, ?, ?, ?)").run(String(c), `Collection ${c}`, now, now).lastInsertRowid)
      for (let m = 0; m < 6; m++) handle.raw.prepare('INSERT INTO collection_member (collection_id, external_id, title, year) VALUES (?, ?, ?, 2000)').run(id, String(100_000 + c * 60 + m), `Part ${m}`)
    }
  })()
  const series = keys.find((x) => x.kind === 'episode')!.k
  const movie = keys.find((x) => x.kind === 'movie')!.k
  const total = (handle.raw.prepare('SELECT COUNT(*) AS n FROM media_file').get() as { n: number }).n
  console.log(`Seeded ${keys.length} identifiable titles (${total} files incl. ${VIDEOS} personal videos).`)
  handle.close()
  return { keys: { series, movie } }
}

