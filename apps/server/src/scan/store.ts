import { win32 } from 'node:path'
import type Database from 'better-sqlite3'
import { desc, eq, inArray } from 'drizzle-orm'
import {
  EMPTY_SUMMARY,
  ScanSummary,
  type MediaFile,
  type MediaFilePage,
  type MediaFileQuery,
  type ScanJob,
  type ScanStatus,
} from '@theama/contracts'
import { z } from 'zod'
import type { Db } from '../db/client'
import { mediaFile, scanJob } from '../db/schema'
import { ftsQuery } from './fts'
import { normaliseTitle, titleKeyFor } from './filename'
import type { ProbeResult } from './probe'

export type FileRow = typeof mediaFile.$inferSelect
export type NewFileRow = typeof mediaFile.$inferInsert

/** Columns a scan may rewrite on an existing row (everything derived from disk or the file name). */
export type FilePatch = Partial<
  Pick<
    FileRow,
    | 'path' | 'size' | 'mtimeMs' | 'volumeId' | 'fileId' | 'state' | 'lastSeenAt' | 'missingSince'
    | 'kind' | 'guessedTitle' | 'guessedYear' | 'season' | 'episode' | 'episodeEnd' | 'episodeTitle' | 'titleKey'
    | 'probedAt' | 'probeError' | 'durationMs' | 'width' | 'height' | 'container' | 'videoCodec' | 'audioCodecs' | 'subtitleCount'
  >
>

const COLUMN_SQL: Record<keyof FilePatch, string> = {
  path: 'path', size: 'size', mtimeMs: 'mtime_ms', volumeId: 'volume_id', fileId: 'file_id', state: 'state',
  lastSeenAt: 'last_seen_at', missingSince: 'missing_since', kind: 'kind', guessedTitle: 'guessed_title',
  guessedYear: 'guessed_year', season: 'season', episode: 'episode', episodeEnd: 'episode_end',
  episodeTitle: 'episode_title', probedAt: 'probed_at', probeError: 'probe_error', durationMs: 'duration_ms',
  width: 'width', height: 'height', container: 'container', videoCodec: 'video_codec', audioCodecs: 'audio_codecs',
  subtitleCount: 'subtitle_count', titleKey: 'title_key',
}

const INSERT_COLUMNS = [
  'source_id', 'path', 'size', 'mtime_ms', 'volume_id', 'file_id', 'state', 'first_seen_at', 'last_seen_at',
  'kind', 'guessed_title', 'guessed_year', 'season', 'episode', 'episode_end', 'episode_title', 'title_key',
] as const

export interface ListRow {
  id: number
  source_id: number
  path: string
  size: number
  mtime_ms: number
  state: 'available' | 'missing_unconfirmed'
  source_availability: 'online' | 'offline' | 'unknown'
  first_seen_at: string
  kind: MediaFile['kind']
  guessed_title: string
  guessed_year: number | null
  season: number | null
  episode: number | null
  episode_end: number | null
  episode_title: string | null
  probed_at: string | null
  probe_error: string | null
  duration_ms: number | null
  width: number | null
  height: number | null
  container: string | null
  video_codec: string | null
  audio_codecs: string | null
  subtitle_count: number | null
}

export function toMediaFile(r: ListRow): MediaFile {
  return {
    id: r.id,
    sourceId: r.source_id,
    path: r.path,
    fileName: win32.basename(r.path),
    size: r.size,
    modifiedAt: new Date(r.mtime_ms).toISOString(),
    kind: r.kind,
    title: r.guessed_title,
    year: r.guessed_year,
    season: r.season,
    episode: r.episode,
    episodeEnd: r.episode_end,
    episodeTitle: r.episode_title,
    state: r.source_availability === 'offline' ? 'source_offline' : r.state,
    probed: r.probed_at !== null,
    durationMs: r.duration_ms,
    width: r.width,
    height: r.height,
    container: r.container,
    videoCodec: r.video_codec,
    audioCodecs: r.audio_codecs ? r.audio_codecs.split(',') : [],
    subtitleCount: r.subtitle_count,
    probeError: r.probe_error,
    firstSeenAt: r.first_seen_at,
  }
}

const Cursor = z.tuple([z.string(), z.number(), z.number(), z.number()])
const encodeCursor = (c: [string, number, number, number]): string => Buffer.from(JSON.stringify(c)).toString('base64url')
function decodeCursor(raw: string): z.infer<typeof Cursor> | null {
  try {
    const parsed = Cursor.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** SQL fragment for the sort key; the same expressions are used for the keyset cursor. */
const SORT_EXPR = "lower(f.guessed_title), coalesce(f.season, -1), coalesce(f.episode, -1), f.id"

export class MediaFileRepo {
  private readonly insertStmt: Database.Statement

  constructor(
    private readonly db: Db,
    private readonly raw: Database.Database,
  ) {
    this.insertStmt = raw.prepare(
      `INSERT INTO media_file (${INSERT_COLUMNS.join(',')}) VALUES (${INSERT_COLUMNS.map(() => '?').join(',')})`,
    )
    this.indexStmt = raw.prepare('INSERT INTO media_file_fts(rowid, guessed_title, episode_title, path_text, meta_text) VALUES (?, ?, ?, ?, ?)')
    this.unindexStmt = raw.prepare('DELETE FROM media_file_fts WHERE rowid = ?')
  }

  private readonly indexStmt: Database.Statement
  private readonly unindexStmt: Database.Statement

  /** (Re)writes the search-index entry of one file from its current columns. Call inside a transaction. */
  private reindex(id: number): void {
    const r = this.raw
      .prepare(
        `SELECT f.guessed_title, f.episode_title, f.path, m.title AS meta_title, m.original_title AS meta_original
         FROM media_file f LEFT JOIN title_metadata m ON m.title_key = f.title_key WHERE f.id = ?`,
      )
      .get(id) as
      | { guessed_title: string; episode_title: string | null; path: string; meta_title: string | null; meta_original: string | null }
      | undefined
    this.unindexStmt.run(id)
    if (r) {
      const meta = [r.meta_title, r.meta_original].filter(Boolean).join(' ')
      this.indexStmt.run(id, normaliseTitle(r.guessed_title), normaliseTitle(r.episode_title ?? ''), normaliseTitle(r.path), normaliseTitle(meta))
    }
  }

  /** Refreshes the search entries of every file of a title, e.g. after the provider's names arrive. */
  reindexTitle(titleKey: string): void {
    this.raw.transaction(() => {
      for (const { id } of this.raw.prepare('SELECT id FROM media_file WHERE title_key = ?').all(titleKey) as { id: number }[]) this.reindex(id)
    })()
  }

  /**
   * Rebuilds the search index when it does not match the table (first start after the index was
   * introduced, or an index damaged by an interrupted write). Cheap when nothing is wrong.
   */
  ensureSearchIndex(): number {
    const rows = (this.raw.prepare('SELECT COUNT(*) AS n FROM media_file').get() as { n: number }).n
    const indexed = (this.raw.prepare('SELECT COUNT(*) AS n FROM media_file_fts_docsize').get() as { n: number }).n
    if (rows === indexed) return 0
    this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM media_file_fts').run()
      for (const { id } of this.raw.prepare('SELECT id FROM media_file').all() as { id: number }[]) this.reindex(id)
    })()
    return rows
  }

  /** Every stored row for a source (paths compared by the caller, case-insensitively). */
  forSource(sourceId: number): FileRow[] {
    return this.db.select().from(mediaFile).where(eq(mediaFile.sourceId, sourceId)).all()
  }

  /** Inserts rows in one transaction and returns their ids in order. */
  insertMany(rows: readonly NewFileRow[]): number[] {
    const ids: number[] = []
    this.raw.transaction(() => {
      for (const r of rows) {
        const info = this.insertStmt.run(
          r.sourceId, r.path, r.size, r.mtimeMs, r.volumeId ?? null, r.fileId ?? null, r.state ?? 'available',
          r.firstSeenAt, r.lastSeenAt, r.kind, r.guessedTitle, r.guessedYear ?? null, r.season ?? null,
          r.episode ?? null, r.episodeEnd ?? null, r.episodeTitle ?? null, r.titleKey ?? null,
        )
        ids.push(Number(info.lastInsertRowid))
        this.reindex(Number(info.lastInsertRowid))
      }
    })()
    return ids
  }

  updateMany(updates: readonly { id: number; patch: FilePatch }[]): void {
    this.raw.transaction(() => {
      for (const { id, patch } of updates) {
        const keys = (Object.keys(patch) as (keyof FilePatch)[]).filter((k) => patch[k] !== undefined)
        if (keys.length === 0) continue
        const set = keys.map((k) => `${COLUMN_SQL[k]} = ?`).join(', ')
        this.raw.prepare(`UPDATE media_file SET ${set} WHERE id = ?`).run(...keys.map((k) => patch[k] ?? null), id)
        if (keys.some((k) => k === 'guessedTitle' || k === 'episodeTitle' || k === 'path' || k === 'titleKey')) this.reindex(id)
      }
    })()
  }

  markMissing(ids: readonly number[], now: string): void {
    this.raw.transaction(() => {
      const stmt = this.raw.prepare("UPDATE media_file SET state = 'missing_unconfirmed', missing_since = COALESCE(missing_since, ?) WHERE id = ?")
      for (const id of ids) stmt.run(now, id)
    })()
  }

  saveProbe(id: number, now: string, result: ProbeResult | null, error: string | null): void {
    this.updateMany([
      {
        id,
        patch: result
          ? {
              probedAt: now, probeError: null, durationMs: result.durationMs, width: result.width, height: result.height,
              container: result.container, videoCodec: result.videoCodec,
              audioCodecs: result.audioCodecs.join(',') || null, subtitleCount: result.subtitleCount,
            }
          : { probedAt: now, probeError: error ?? 'Unknown probe error' },
      },
    ])
  }

  /** Gives rows created before title keys existed their key (derived from the stored parse columns). */
  backfillTitleKeys(): number {
    const rows = this.raw
      .prepare('SELECT id, kind, guessed_title, guessed_year, path FROM media_file WHERE title_key IS NULL')
      .all() as { id: number; kind: MediaFile['kind']; guessed_title: string; guessed_year: number | null; path: string }[]
    this.raw.transaction(() => {
      const stmt = this.raw.prepare('UPDATE media_file SET title_key = ? WHERE id = ?')
      for (const r of rows) stmt.run(titleKeyFor(r.kind, r.guessed_title, r.guessed_year, r.path), r.id)
    })()
    return rows.length
  }

  countAvailable(): number {
    return (this.raw.prepare("SELECT COUNT(*) AS n FROM media_file WHERE kind <> 'extra' AND state = 'available'").get() as { n: number }).n
  }

  list(query: MediaFileQuery): MediaFilePage {
    const limit = Math.min(Math.max(Number(query.limit ?? 100), 1), 500)
    const where: string[] = []
    const params: (string | number)[] = []

    if (query.kind) {
      where.push('f.kind = ?')
      params.push(query.kind)
    } else {
      where.push("f.kind <> 'extra'")
    }
    if (query.sourceId) {
      where.push('f.source_id = ?')
      params.push(Number(query.sourceId))
    }
    const q = query.q?.trim()
    if (q) {
      const fts = ftsQuery(q)
      // Nothing searchable typed (only punctuation): match nothing rather than everything.
      where.push(fts ? 'f.id IN (SELECT rowid FROM media_file_fts WHERE media_file_fts MATCH ?)' : '0')
      if (fts) params.push(fts)
    }
    if (query.hideUnavailable === true || (query.hideUnavailable as unknown) === 'true') {
      where.push("s.availability <> 'offline' AND f.state = 'available'")
    }
    const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const from = 'FROM media_file f JOIN library_source s ON s.id = f.source_id'
    const total = (this.raw.prepare(`SELECT COUNT(*) AS n ${from} ${baseWhere}`).get(...params) as { n: number }).n

    const pageWhere = [...where]
    const pageParams = [...params]
    const cursor = query.cursor ? decodeCursor(query.cursor) : null
    if (cursor) {
      pageWhere.push(`(${SORT_EXPR}) > (?, ?, ?, ?)`)
      pageParams.push(...cursor)
    }
    const rows = this.raw
      .prepare(
        `SELECT f.*, s.availability AS source_availability ${from}
         ${pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : ''}
         ORDER BY ${SORT_EXPR} LIMIT ?`,
      )
      .all(...pageParams, limit + 1) as ListRow[]

    const hasMore = rows.length > limit
    const items = rows.slice(0, limit)
    const last = items[items.length - 1]
    return {
      items: items.map(toMediaFile),
      nextCursor: hasMore && last ? encodeCursor([last.guessed_title.toLowerCase(), last.season ?? -1, last.episode ?? -1, last.id]) : null,
      total,
    }
  }
}

type JobRow = typeof scanJob.$inferSelect

function toJob(row: JobRow): ScanJob {
  let summary = EMPTY_SUMMARY
  try {
    summary = ScanSummary.parse({ ...EMPTY_SUMMARY, ...(row.summary ? JSON.parse(row.summary) : {}) })
  } catch {
    // A corrupt summary shows as zeros rather than breaking the list.
  }
  let diagnostics: string[] = []
  try {
    const parsed: unknown = row.diagnostics ? JSON.parse(row.diagnostics) : []
    if (Array.isArray(parsed)) diagnostics = parsed.map(String)
  } catch {
    diagnostics = row.diagnostics ? [row.diagnostics] : []
  }
  return { id: row.id, sourceId: row.sourceId, status: row.status, startedAt: row.startedAt, finishedAt: row.finishedAt, summary, diagnostics }
}

export class ScanJobRepo {
  constructor(private readonly db: Db) {}

  create(sourceId: number): ScanJob {
    const row = this.db.insert(scanJob).values({ sourceId, status: 'queued' }).returning().get()
    return toJob(row)
  }

  get(id: number): ScanJob | null {
    const row = this.db.select().from(scanJob).where(eq(scanJob.id, id)).get()
    return row ? toJob(row) : null
  }

  list(limit = 50): ScanJob[] {
    return this.db.select().from(scanJob).orderBy(desc(scanJob.id)).limit(limit).all().map(toJob)
  }

  setRunning(id: number, now: string): void {
    this.db.update(scanJob).set({ status: 'running', startedAt: now }).where(eq(scanJob.id, id)).run()
  }

  finish(id: number, status: Extract<ScanStatus, 'done' | 'failed' | 'cancelled'>, now: string, summary: ScanSummary, diagnostics: string[]): ScanJob {
    this.db
      .update(scanJob)
      .set({ status, finishedAt: now, summary: JSON.stringify(summary), diagnostics: JSON.stringify(diagnostics) })
      .where(eq(scanJob.id, id))
      .run()
    return this.get(id)!
  }

  /** Jobs that were queued or running when the service stopped can never finish. Returns the sources they belonged to. */
  failInterrupted(now: string): number[] {
    const stuck = this.db.select().from(scanJob).where(inArray(scanJob.status, ['queued', 'running'])).all()
    for (const row of stuck) {
      this.db
        .update(scanJob)
        .set({ status: 'failed', finishedAt: now, diagnostics: JSON.stringify(['Interrupted: the service stopped during this scan.']) })
        .where(eq(scanJob.id, row.id))
        .run()
    }
    return [...new Set(stuck.map((r) => r.sourceId))]
  }
}
