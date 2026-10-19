import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { MediaKind, TitleDetail, TitleKind, TitlePage, TitleQuery, TitleSort, TitleSummary } from '@theama/contracts'
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
         MIN(f.guessed_title COLLATE BINARY) AS title,
         MAX(f.guessed_year) AS year,
         COUNT(*) AS file_count,
         COUNT(DISTINCT CASE WHEN f.episode IS NOT NULL THEN coalesce(f.season, -1) * 100000 + f.episode END) AS episode_count,
         COUNT(DISTINCT f.season) AS season_count,
         SUM(CASE WHEN s.availability <> 'offline' AND f.state = 'available' THEN 1 ELSE 0 END) AS available_count,
         MAX(f.first_seen_at) AS added_at,
         SUM(f.size) AS size
  FROM media_file f JOIN library_source s ON s.id = f.source_id`

export class TitleRepo {
  constructor(private readonly raw: Database.Database) {}

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
    return { summary, files: rows.map(toMediaFile) }
  }
}
