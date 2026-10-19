import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { MediaKind, TitleDetail, TitleKind, TitlePage, TitleQuery, TitleSort, TitleSummary } from '@theama/contracts'
import { collectionRefsFor } from '../collections/refs'
import { artworkUrl } from '../metadata/artwork'
import type { MetadataRepo } from '../metadata/store'
import { buildCoverage } from './coverage'
import { ftsQuery } from './fts'
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
  }
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
         MAX(cov.missing) AS missing_episodes
  FROM media_file f JOIN library_source s ON s.id = f.source_id
       LEFT JOIN title_metadata d ON d.title_key = f.title_key
       LEFT JOIN title_match m ON m.title_key = f.title_key
       LEFT JOIN (
         -- Aired episodes (specials excluded) that no file covers; a file may cover a range (E03-E04).
         SELECT em.title_key AS k,
                SUM(CASE WHEN em.season > 0 AND em.air_date IS NOT NULL AND em.air_date <= date('now')
                          AND NOT EXISTS (SELECT 1 FROM media_file f2
                                           WHERE f2.title_key = em.title_key AND f2.season = em.season
                                             AND em.episode BETWEEN f2.episode AND coalesce(f2.episode_end, f2.episode))
                         THEN 1 ELSE 0 END) AS missing
           FROM episode_metadata em GROUP BY em.title_key
       ) cov ON cov.k = f.title_key`

export class TitleRepo {
  constructor(
    private readonly raw: Database.Database,
    private readonly metadata?: MetadataRepo,
  ) {}

  list(query: TitleQuery): TitlePage {
    const limit = Math.min(Math.max(Number(query.limit ?? 60), 1), 200)
    const sort: TitleSort = (query.sort as TitleSort | undefined) ?? 'title'
    const where: string[] = []
    const params: (string | number)[] = []

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
    if (query.hideUnavailable === true || (query.hideUnavailable as unknown) === 'true') {
      where.push("s.availability <> 'offline' AND f.state = 'available'")
    }
    const grouped = `${GROUP_SELECT} WHERE ${where.join(' AND ')} GROUP BY f.kind, f.title_key`

    const total = (this.raw.prepare(`SELECT COUNT(*) AS n FROM (${grouped})`).get(...params) as { n: number }).n

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
      .all(...params, ...cursorParams, limit + 1) as GroupRow[]
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
    return { items: page.map(toSummary).filter((s): s is TitleSummary => s !== null), nextCursor, total }
  }

  /** Library cards for specific title keys (collections use this); unknown keys are simply absent. */
  summaries(keys: readonly string[]): Map<string, TitleSummary> {
    const out = new Map<string, TitleSummary>()
    for (let i = 0; i < keys.length; i += 400) {
      const chunk = keys.slice(i, i + 400)
      const rows = this.raw
        .prepare(`${GROUP_SELECT} WHERE f.kind <> 'extra' AND f.title_key IN (${chunk.map(() => '?').join(',')}) GROUP BY f.kind, f.title_key`)
        .all(...chunk) as GroupRow[]
      for (const r of rows) {
        const s = toSummary(r)
        if (s) out.set(s.key, s)
      }
    }
    return out
  }

  /** One title with all of its files, or null if the key is unknown. */
  detail(key: string): TitleDetail | null {
    const group = this.raw.prepare(`${GROUP_SELECT} WHERE f.title_key = ? GROUP BY f.kind, f.title_key`).get(key) as GroupRow | undefined
    const summary = group ? toSummary(group) : null
    if (!group || !summary) return null
    const rows = this.raw
      .prepare(
        `SELECT f.*, s.availability AS source_availability
         FROM media_file f JOIN library_source s ON s.id = f.source_id
         WHERE f.title_key = ?
         ORDER BY coalesce(f.season, -1), coalesce(f.episode, -1), lower(f.path)`,
      )
      .all(key) as ListRow[]
    const stored = this.metadata?.getMatch(key) ?? null
    const providerEpisodes = summary.kind === 'series' ? (this.metadata?.episodes(key) ?? []) : []
    const covered =
      providerEpisodes.length > 0
        ? buildCoverage(
            providerEpisodes,
            rows.filter((r) => r.kind === 'episode').map((r) => ({ id: r.id, season: r.season, episode: r.episode, episodeEnd: r.episode_end })),
            new Date().toISOString().slice(0, 10),
          )
        : null
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
      metadata: this.metadata?.getMetadata(key) ?? null,
      episodes: covered?.episodes ?? [],
      coverage: covered?.coverage ?? null,
      collections: collectionRefsFor(this.raw, key),
    }
  }
}
