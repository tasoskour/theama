import { win32 } from 'node:path'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { LibraryType, MediaKind, ProviderIdentity, ReclassifyTitleResult, RemoveTitleResult, TitleDetail, TitleKind, TitlePage, TitleQuery, TitleSort, TitleSummary } from '@theama/contracts'
import { GENRE_SEPARATOR } from '@theama/contracts'
import { collectionRefsFor } from '../collections/refs'
import { artworkUrl } from '../metadata/artwork'
import type { MetadataRepo } from '../metadata/store'
import { nextEpisode, toEpisodeFile } from '../playback/next'
import { buildCoverage } from './coverage'
import { ftsQuery } from './fts'
import { parseMediaPath, titleKeyFor } from './filename'
import { toMediaFile, type ListRow } from './store'

const KIND_TO_DB: Record<TitleKind, MediaKind> = { movie: 'movie', series: 'episode', video: 'video' }
const KIND_FROM_DB: Partial<Record<MediaKind, TitleKind>> = { movie: 'movie', episode: 'series', video: 'video' }

interface GroupRow {
  key: string
  kind: MediaKind
  title: string
  year: number | null
  file_count: number
  episode_count: number
  season_count: number
  available_count: number
  added_at: string
  size: number
  poster_file: string | null
  rating: number | null
  match_state: 'matched' | 'ambiguous' | 'unmatched' | null
  missing_episodes: number | null
  watched_files: number
  watched_episodes: number
  category_override: number
}

function toSummary(r: GroupRow): TitleSummary | null {
  const kind = KIND_FROM_DB[r.kind]
  if (!kind) return null
  return {
    key: r.key,
    kind,
    title: r.title,
    year: r.year,
    fileCount: r.file_count,
    episodeCount: r.episode_count,
    seasonCount: r.season_count,
    availableCount: r.available_count,
    addedAt: r.added_at,
    size: r.size,
    posterUrl: artworkUrl(r.poster_file),
    rating: r.rating,
    matchState: r.match_state,
    missingEpisodes: r.missing_episodes,
    watchState: watchState(r),
    categoryOverride: r.category_override === 1,
  }
}

/** A series counts episodes (two copies of one episode are one episode); a film or video is watched or not. */
function watchState(r: GroupRow): 'none' | 'some' | 'all' {
  if (r.watched_files === 0) return 'none'
  if (r.kind !== 'episode') return 'all'
  const total = r.episode_count > 0 ? r.episode_count : r.file_count
  const seen = r.episode_count > 0 ? r.watched_episodes : r.watched_files
  return seen >= total ? 'all' : 'some'
}

const Cursor = z.array(z.union([z.string(), z.number()])).min(2).max(3)

function encodeCursor(values: (string | number)[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url')
}
function decodeCursor(raw: string | undefined): (string | number)[] | null {
  if (!raw) return null
  try {
    const parsed = Cursor.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The grouped view of files: one entry per movie, per series, per personal video. */
const GROUP_SELECT = `
  SELECT f.title_key AS key, f.kind AS kind,
         coalesce(MAX(d.title), MIN(f.guessed_title COLLATE BINARY)) AS title,
         coalesce(MAX(d.year), MAX(f.guessed_year)) AS year,
         COUNT(*) AS file_count,
         COUNT(DISTINCT CASE WHEN f.episode IS NOT NULL THEN coalesce(f.season, -1) * 100000 + f.episode END) AS episode_count,
         COUNT(DISTINCT f.season) AS season_count,
         SUM(CASE WHEN s.availability <> 'offline' AND f.state = 'available' THEN 1 ELSE 0 END) AS available_count,
         MAX(f.first_seen_at) AS added_at,
         SUM(f.size) AS size,
         MAX(d.poster_file) AS poster_file,
         MAX(d.rating) AS rating,
         MAX(m.state) AS match_state,
         NULL AS missing_episodes,
         SUM(coalesce(pb.watched, 0)) AS watched_files,
         COUNT(DISTINCT CASE WHEN pb.watched = 1 AND f.episode IS NOT NULL THEN coalesce(f.season, -1) * 100000 + f.episode END) AS watched_episodes
         ,MAX(CASE WHEN f.kind_override IS NOT NULL THEN 1 ELSE 0 END) AS category_override
  FROM media_file f JOIN library_source s ON s.id = f.source_id
       LEFT JOIN title_metadata d ON d.title_key = f.title_key
       LEFT JOIN title_match m ON m.title_key = f.title_key
       LEFT JOIN playback_state pb ON pb.file_id = f.id`

/**
 * Aired episodes (specials excluded) that no file covers; a file may cover a range (E03-E04). Worked out for
 * the few titles on a page rather than inside the library-wide grouping, which would repeat it for every title.
 */
function fillMissingEpisodes(raw: Database.Database, rows: GroupRow[]): void {
  const series = rows.filter((r) => r.kind === 'episode')
  if (series.length === 0) return
  const found = new Map<string, number>()
  for (let i = 0; i < series.length; i += 400) {
    const chunk = series.slice(i, i + 400).map((r) => r.key)
    const result = raw
      .prepare(
        `SELECT em.title_key AS k,
                SUM(CASE WHEN em.season > 0 AND em.air_date IS NOT NULL AND em.air_date <= date('now')
                          AND NOT EXISTS (SELECT 1 FROM media_file f2
                                           WHERE f2.title_key = em.title_key AND f2.season = em.season AND f2.excluded = 0
                                             AND em.episode BETWEEN f2.episode AND coalesce(f2.episode_end, f2.episode))
                         THEN 1 ELSE 0 END) AS missing
           FROM episode_metadata em WHERE em.title_key IN (${chunk.map(() => '?').join(',')}) GROUP BY em.title_key`,
      )
      .all(...chunk) as { k: string; missing: number }[]
    for (const r of result) found.set(r.k, r.missing)
  }
  for (const r of series) r.missing_episodes = found.get(r.key) ?? null
}

export class TitleRepo {
  private readonly pages = new Map<string, TitlePage>()
  private pageRevision = ''
  constructor(
    private readonly raw: Database.Database,
    private readonly metadata?: MetadataRepo,
  ) {}

  /** Exact identities of visible library groups, including retained files on offline drives. */
  identities(): ProviderIdentity[] {
    return this.raw.prepare(`SELECT DISTINCT m.provider, m.kind, m.external_id AS externalId
      FROM title_match m JOIN media_file f ON f.title_key = m.title_key
      JOIN library_source s ON s.id = f.source_id
      WHERE m.state = 'matched' AND m.provider IS NOT NULL AND m.external_id IS NOT NULL
        AND f.excluded = 0 AND ((m.kind = 'movie' AND f.kind = 'movie') OR (m.kind = 'series' AND f.kind = 'episode'))`)
      .all() as ProviderIdentity[]
  }

  /** Changes Theama's interpretation of every file represented by a title; disk paths are never changed. */
  reclassify(key: string, kind: TitleKind | null): ReclassifyTitleResult | null {
    type ActionFile = {
      id: number; path: string; source_path: string; library_type: LibraryType
    }
    const rows = this.raw.prepare(
      `SELECT f.id, f.path, s.path AS source_path, s.library_type
         FROM media_file f JOIN library_source s ON s.id = f.source_id
        WHERE f.title_key = ? ORDER BY f.id`,
    ).all(key) as ActionFile[]
    if (rows.length === 0) return null

    const override: Exclude<MediaKind, 'extra'> | null = kind === 'series' ? 'episode' : kind
    const targetSource: Record<Exclude<MediaKind, 'extra'>, LibraryType> = { movie: 'movies', episode: 'series', video: 'videos' }
    const memberships = this.raw.prepare(
      `SELECT collection_id, custom_order FROM collection_member WHERE title_key = ?`,
    ).all(key) as { collection_id: number; custom_order: number | null }[]
    const resulting = new Set<string>()
    const now = new Date().toISOString()

    this.raw.transaction(() => {
      const update = this.raw.prepare(
        `UPDATE media_file SET kind_override = ?, kind = ?, guessed_title = ?, guessed_year = ?, season = ?,
          episode = ?, episode_end = ?, episode_title = ?, title_key = ? WHERE id = ?`,
      )
      for (const row of rows) {
        const relative = win32.relative(row.source_path, row.path).split(/[\\/]+/).filter(Boolean)
        const effectiveSource = override ? targetSource[override] : row.library_type
        let parsed = parseMediaPath([win32.basename(row.source_path), ...relative], effectiveSource)
        if (override && parsed.kind === 'extra') parsed = { ...parsed, kind: override }
        const nextKey = titleKeyFor(parsed.kind, parsed.title, parsed.year, row.path)
        resulting.add(nextKey)
        update.run(override, parsed.kind, parsed.title, parsed.year, parsed.season, parsed.episode, parsed.episodeEnd, parsed.episodeTitle, nextKey, row.id)
      }

      this.raw.prepare('DELETE FROM collection_member WHERE title_key = ?').run(key)
      const describe = this.raw.prepare(
        `SELECT MIN(guessed_title) AS title, MAX(guessed_year) AS year FROM media_file WHERE title_key = ?`,
      )
      const addMember = this.raw.prepare(
        `INSERT OR IGNORE INTO collection_member (collection_id, title_key, title, year, custom_order) VALUES (?, ?, ?, ?, ?)`,
      )
      for (const nextKey of resulting) {
        const description = describe.get(nextKey) as { title: string; year: number | null }
        for (const member of memberships) addMember.run(member.collection_id, nextKey, description.title, description.year, member.custom_order)
      }
      for (const member of memberships) this.raw.prepare('UPDATE collection SET updated_at = ? WHERE id = ?').run(now, member.collection_id)

      this.purgeTitleData(key)
      for (const row of rows) this.reindexFile(row.id)
    })()

    return { affectedFileCount: rows.length, resultingTitleKeys: [...resulting], kind }
  }

  /** Excludes a title and removes only Theama-owned data. The media files and operation journal stay intact. */
  remove(key: string): RemoveTitleResult | null {
    const rows = this.raw.prepare('SELECT id, source_id, path FROM media_file WHERE title_key = ?').all(key) as { id: number; source_id: number; path: string }[]
    if (rows.length === 0) return null
    const now = new Date().toISOString()
    this.raw.transaction(() => {
      const exclude = this.raw.prepare("INSERT OR IGNORE INTO library_exclusion (source_id, path, kind, created_at) VALUES (?, ?, 'file', ?)")
      const hide = this.raw.prepare('UPDATE media_file SET excluded = 1 WHERE id = ?')
      const clearPlayback = this.raw.prepare('DELETE FROM playback_state WHERE file_id = ?')
      for (const row of rows) {
        exclude.run(row.source_id, row.path, now)
        hide.run(row.id)
        clearPlayback.run(row.id)
      }
      this.raw.prepare('DELETE FROM collection_member WHERE title_key = ?').run(key)
      this.purgeTitleData(key)
      for (const row of rows) this.reindexFile(row.id)
    })()
    return { removedFileCount: rows.length }
  }

  private purgeTitleData(key: string): void {
    this.raw.prepare('DELETE FROM episode_metadata WHERE title_key = ?').run(key)
    this.raw.prepare('DELETE FROM title_metadata WHERE title_key = ?').run(key)
    this.raw.prepare('DELETE FROM title_match WHERE title_key = ?').run(key)
  }

  private reindexFile(id: number): void {
    const row = this.raw.prepare(
      `SELECT f.guessed_title, f.episode_title, f.path, d.title AS meta_title, d.original_title AS meta_original
         FROM media_file f LEFT JOIN title_metadata d ON d.title_key = f.title_key WHERE f.id = ?`,
    ).get(id) as { guessed_title: string; episode_title: string | null; path: string; meta_title: string | null; meta_original: string | null } | undefined
    this.raw.prepare('DELETE FROM media_file_fts WHERE rowid = ?').run(id)
    if (!row) return
    const normalise = (value: string): string => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const meta = [row.meta_title, row.meta_original].filter(Boolean).join(' ')
    this.raw.prepare('INSERT INTO media_file_fts(rowid, guessed_title, episode_title, path_text, meta_text) VALUES (?, ?, ?, ?, ?)')
      .run(id, normalise(row.guessed_title), normalise(row.episode_title ?? ''), normalise(row.path), normalise(meta))
  }

  list(query: TitleQuery): TitlePage {
    // Repeated Home rails and returning to a library page need no repeated grouping/sorting.
    // Track both this connection's writes and other connections; events alone miss some writes.
    if (this.raw.inTransaction) {
      this.pageRevision = ''
      return this.readPage(query)
    }
    const changes = (this.raw.prepare('SELECT total_changes() AS n').get() as { n: number }).n
    const revision = `${changes}:${this.raw.pragma('data_version', { simple: true })}:${new Date().toISOString().slice(0, 10)}`
    if (revision !== this.pageRevision) { this.pages.clear(); this.pageRevision = revision }
    const key = JSON.stringify(query)
    const known = this.pages.get(key)
    if (known) {
      this.pages.delete(key)
      this.pages.set(key, known)
      return structuredClone(known)
    }
    const page = this.readPage(query)
    this.pages.set(key, structuredClone(page))
    if (this.pages.size > 128) this.pages.delete(this.pages.keys().next().value!)
    return page
  }

  private readPage(query: TitleQuery): TitlePage {
    const limit = Math.min(Math.max(Number(query.limit ?? 60), 1), 200)
    const sort: TitleSort = (query.sort as TitleSort | undefined) ?? 'title'
    const where: string[] = []
    const params: (string | number)[] = []

    where.push('f.excluded = 0')
    if (query.kind) {
      where.push('f.kind = ?')
      params.push(KIND_TO_DB[query.kind])
    } else {
      where.push("f.kind <> 'extra'")
    }
    const fts = query.q ? ftsQuery(query.q) : null
    if (query.q?.trim() && fts === null) return { items: [], nextCursor: null, total: 0 }
    if (fts) {
      where.push('f.id IN (SELECT rowid FROM media_file_fts WHERE media_file_fts MATCH ?)')
      params.push(fts)
    }
    const genres = (query.genres ?? '').split(GENRE_SEPARATOR).map((g) => g.trim()).filter(Boolean)
    if (genres.length > 0) {
      // "all" counts how many of the wanted genres a title has (distinct, so a repeated name cannot cheat).
      const needed = query.genreMode === 'all' ? new Set(genres).size : 1
      where.push(
        `f.title_key IN (SELECT d2.title_key FROM title_metadata d2
           WHERE (SELECT COUNT(DISTINCT value) FROM json_each(d2.genres) WHERE value IN (${genres.map(() => '?').join(',')})) >= ?)`,
      )
      params.push(...genres, needed)
    }
    if (query.hideUnavailable === true || (query.hideUnavailable as unknown) === 'true') {
      where.push("s.availability <> 'offline' AND f.state = 'available'")
    }
    // Choosing the page needs only a title's name, year and date added; counting, availability and the rest
    // are worked out afterwards for the few titles shown. (Doing it all for every title first made a library
    // of 5,000 titles slow to open.)
    const joinSource = query.hideUnavailable === true || (query.hideUnavailable as unknown) === 'true' ? 'JOIN library_source s ON s.id = f.source_id' : ''
    const filters = where.join(' AND ')
    const total = (this.raw.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM media_file f ${joinSource} WHERE ${filters} GROUP BY f.kind, f.title_key)`).get(...params) as { n: number }).n
    const grouped = `SELECT f.kind AS kind, f.title_key AS key,
         coalesce(MAX(d.title), MIN(f.guessed_title COLLATE BINARY)) AS title,
         coalesce(MAX(d.year), MAX(f.guessed_year)) AS year,
         MAX(f.first_seen_at) AS added_at
       FROM media_file f ${joinSource} LEFT JOIN title_metadata d ON d.title_key = f.title_key
       WHERE ${filters} GROUP BY f.kind, f.title_key`

    const orderBy = {
      title: 'lower(title), key',
      added: 'added_at DESC, key',
      year: 'coalesce(year, 0) DESC, lower(title), key',
    }[sort]

    const cursor = decodeCursor(query.cursor)
    const cursorParams: (string | number)[] = []
    let cursorWhere = ''
    if (cursor) {
      if (sort === 'title' && cursor.length === 2) {
        cursorWhere = 'WHERE (lower(title), key) > (?, ?)'
        cursorParams.push(...cursor)
      } else if (sort === 'added' && cursor.length === 2) {
        cursorWhere = 'WHERE added_at < ? OR (added_at = ? AND key > ?)'
        cursorParams.push(cursor[0]!, cursor[0]!, cursor[1]!)
      } else if (sort === 'year' && cursor.length === 3) {
        cursorWhere = 'WHERE coalesce(year, 0) < ? OR (coalesce(year, 0) = ? AND (lower(title), key) > (?, ?))'
        cursorParams.push(cursor[0]!, cursor[0]!, cursor[1]!, cursor[2]!)
      }
    }

    const rows = this.raw
      .prepare(`SELECT * FROM (${grouped}) ${cursorWhere} ORDER BY ${orderBy} LIMIT ?`)
      .all(...params, ...cursorParams, limit + 1) as { kind: MediaKind; key: string; title: string; year: number | null; added_at: string }[]
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    let nextCursor: string | null = null
    if (hasMore && last) {
      nextCursor =
        sort === 'title'
          ? encodeCursor([last.title.toLowerCase(), last.key])
          : sort === 'added'
            ? encodeCursor([last.added_at, last.key])
            : encodeCursor([last.year ?? 0, last.title.toLowerCase(), last.key])
    }
    const described = this.summaries(page.map((p) => p.key))
    return { items: page.flatMap((p) => described.get(p.key) ?? []), nextCursor, total }
  }

  /** The genres of identified titles that are in the library (optionally of one kind), alphabetically. */
  genres(kind?: TitleKind): string[] {
    const rows = this.raw
      .prepare(
        `SELECT DISTINCT j.value AS genre
           FROM title_metadata d, json_each(d.genres) j
          WHERE d.title_key IN (SELECT title_key FROM media_file WHERE excluded = 0 AND ${kind ? 'kind = ?' : "kind <> 'extra'"})
            AND j.value <> ''
          ORDER BY lower(j.value)`,
      )
      .all(...(kind ? [KIND_TO_DB[kind]] : [])) as { genre: string }[]
    return rows.map((r) => r.genre)
  }

  /** Library cards for specific title keys (collections use this); unknown keys are simply absent. */
  summaries(keys: readonly string[]): Map<string, TitleSummary> {
    const out = new Map<string, TitleSummary>()
    for (let i = 0; i < keys.length; i += 400) {
      const chunk = keys.slice(i, i + 400)
      const rows = this.raw
        .prepare(`${GROUP_SELECT} WHERE f.excluded = 0 AND f.kind <> 'extra' AND f.title_key IN (${chunk.map(() => '?').join(',')}) GROUP BY f.kind, f.title_key`)
        .all(...chunk) as GroupRow[]
      fillMissingEpisodes(this.raw, rows)
      for (const r of rows) {
        const s = toSummary(r)
        if (s) out.set(s.key, s)
      }
    }
    return out
  }

  /** One title with all of its files, or null if the key is unknown. */
  detail(key: string): TitleDetail | null {
    const group = this.raw.prepare(`${GROUP_SELECT} WHERE f.excluded = 0 AND f.title_key = ? GROUP BY f.kind, f.title_key`).get(key) as GroupRow | undefined
    if (group) fillMissingEpisodes(this.raw, [group])
    const summary = group ? toSummary(group) : null
    if (!group || !summary) return null
    const rows = this.raw
      .prepare(
        `SELECT f.*, s.availability AS source_availability, p.watched AS watched, p.last_played_at AS last_played_at, p.position_seconds AS position_seconds
         FROM media_file f JOIN library_source s ON s.id = f.source_id LEFT JOIN playback_state p ON p.file_id = f.id
         WHERE f.excluded = 0 AND f.title_key = ?
         ORDER BY coalesce(f.season, -1), coalesce(f.episode, -1), lower(f.path)`,
      )
      .all(key) as ListRow[]
    const stored = this.metadata?.getMatch(key) ?? null
    const lastPlayedAt = rows.reduce<string | null>((latest, r) => (r.last_played_at && (!latest || r.last_played_at > latest) ? r.last_played_at : latest), null)
    const next =
      summary.kind === 'series'
        ? nextEpisode(rows.filter((r) => r.kind === 'episode').map((r) => toEpisodeFile({ id: r.id, season: r.season, episode: r.episode, watched: r.watched, position_seconds: r.position_seconds, state: r.state, availability: r.source_availability })))
        : null
    const providerEpisodes = summary.kind === 'series' ? (this.metadata?.episodes(key) ?? []) : []
    const covered =
      providerEpisodes.length > 0
        ? buildCoverage(
            providerEpisodes,
            rows.filter((r) => r.kind === 'episode').map((r) => ({ id: r.id, season: r.season, episode: r.episode, episodeEnd: r.episode_end })),
            new Date().toISOString().slice(0, 10),
          )
        : null
    const metadata = this.metadata?.getMetadata(key) ?? null
    const creditLinks = this.metadata?.creditLinks(key) ?? []
    const related = this.summaries([...new Set(creditLinks.flatMap((credit) => credit.relatedKeys))])
    const credits = creditLinks.map(({ relatedKeys, ...credit }) => ({
      ...credit,
      relatedTitles: relatedKeys
        .flatMap((relatedKey) => related.get(relatedKey) ?? [])
        .filter((title) => title.availableCount > 0 && (title.kind === 'movie' || title.kind === 'series'))
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title)),
    }))
    return {
      summary,
      files: rows.map(toMediaFile),
      match: stored
        ? {
            state: stored.state,
            decidedBy: stored.decidedBy,
            locked: stored.locked,
            score: stored.score,
            provider: stored.provider,
            externalId: stored.externalId,
            candidates: stored.candidates,
          }
        : null,
      metadata,
      credits,
      episodes: covered?.episodes ?? [],
      coverage: covered?.coverage ?? null,
      collections: collectionRefsFor(this.raw, key),
      playback: { next, lastPlayedAt },
    }
  }
}
