import type Database from 'better-sqlite3'
import type { ContinueItem, MediaKind, SubtitleTrack } from '@theama/contracts'
import { parseTracks } from '../scan/store'
import type { TitleRepo } from '../scan/titles'
import { nextEpisode, toEpisodeFile, type EpisodeFile } from './next'

export class PlaybackProblem extends Error {
  constructor(
    readonly code: 'not_found' | 'unavailable',
    message: string,
  ) {
    super(message)
  }
}

export interface LaunchFile {
  id: number
  path: string
  kind: MediaKind
  title: string
  /** Present, and its folder is online. */
  available: boolean
  state: 'available' | 'missing_unconfirmed'
  sourceOffline: boolean
}

interface FileRow {
  id: number
  season: number | null
  episode: number | null
  watched: number | null
  state: 'available' | 'missing_unconfirmed'
  availability: 'online' | 'offline' | 'unknown'
}

/**
 * What has been watched and started. Theama cannot see inside an external player, so "watched" is a
 * mark the person sets (per file, episode, season or title); starting a file only records that it was
 * started. Both are kept per file, so renaming or moving a file keeps its state.
 */
export class PlaybackRepo {
  constructor(
    private readonly raw: Database.Database,
    private readonly titles: TitleRepo,
  ) {}

  /** Marks files watched or unwatched. Unknown ids are ignored; returns how many files changed. */
  setWatched(fileIds: readonly number[], watched: boolean, now: string): number {
    if (fileIds.length === 0) return 0
    const exists = this.raw.prepare('SELECT 1 FROM media_file WHERE id = ?')
    const upsert = this.raw.prepare(
      `INSERT INTO playback_state (file_id, watched, watched_at, source) VALUES (@id, @watched, @at, 'manual')
       ON CONFLICT(file_id) DO UPDATE SET watched = @watched, watched_at = @at, source = 'manual'`,
    )
    let changed = 0
    this.raw.transaction(() => {
      for (const id of fileIds) {
        if (!exists.get(id)) continue
        upsert.run({ id, watched: watched ? 1 : 0, at: watched ? now : null })
        changed++
      }
    })()
    return changed
  }

  /** Every playable file of a title, or only one season of it. */
  setTitleWatched(key: string, watched: boolean, season: number | null | undefined, now: string): number {
    const ids = (
      this.raw
        .prepare(`SELECT id FROM media_file WHERE title_key = ? AND kind <> 'extra' ${season === null || season === undefined ? '' : 'AND season = ?'}`)
        .all(...(season === null || season === undefined ? [key] : [key, season])) as { id: number }[]
    ).map((r) => r.id)
    if (ids.length === 0) throw new PlaybackProblem('not_found', 'No such title')
    return this.setWatched(ids, watched, now)
  }

  /** Records that a player was started on this file. Does not change whether it counts as watched. */
  launched(fileId: number, now: string): void {
    const exists = this.raw.prepare('SELECT 1 FROM media_file WHERE id = ?').get(fileId)
    if (!exists) throw new PlaybackProblem('not_found', 'No such file')
    this.raw
      .prepare(
        `INSERT INTO playback_state (file_id, last_played_at, play_count, source) VALUES (?, ?, 1, 'launch')
         ON CONFLICT(file_id) DO UPDATE SET last_played_at = excluded.last_played_at, play_count = play_count + 1`,
      )
      .run(fileId, now)
  }

  /** The file a player would be started on, with whether that is possible right now. */
  fileForLaunch(fileId: number): LaunchFile | null {
    const r = this.raw
      .prepare(
        `SELECT f.id, f.path, f.kind, f.guessed_title AS title, f.state, s.availability
           FROM media_file f JOIN library_source s ON s.id = f.source_id WHERE f.id = ?`,
      )
      .get(fileId) as { id: number; path: string; kind: MediaKind; title: string; state: 'available' | 'missing_unconfirmed'; availability: string } | undefined
    if (!r) return null
    const sourceOffline = r.availability === 'offline'
    return { id: r.id, path: r.path, kind: r.kind, title: r.title, state: r.state, sourceOffline, available: r.state === 'available' && !sourceOffline }
  }

  /** Subtitle streams inside the file, as FFprobe reported them (empty if it has not been read yet). */
  embeddedSubtitles(fileId: number): SubtitleTrack[] {
    const r = this.raw.prepare('SELECT tracks FROM media_file WHERE id = ?').get(fileId) as { tracks: string | null } | undefined
    return parseTracks(r?.tracks ?? null).subtitleTracks
  }

  private episodeFiles(key: string): EpisodeFile[] {
    const rows = this.raw
      .prepare(
        `SELECT f.id, f.season, f.episode, p.watched AS watched, f.state, s.availability
           FROM media_file f JOIN library_source s ON s.id = f.source_id LEFT JOIN playback_state p ON p.file_id = f.id
          WHERE f.title_key = ? AND f.kind = 'episode'`,
      )
      .all(key) as FileRow[]
    return rows.map(toEpisodeFile)
  }

  /** The "continue watching" rail: series with a next episode, and films started but not marked watched. */
  continueWatching(limit: number): ContinueItem[] {
    const candidates = this.raw
      .prepare(
        `SELECT f.title_key AS key, f.kind AS kind,
                MAX(max(coalesce(p.last_played_at, ''), coalesce(p.watched_at, ''))) AS activity
           FROM playback_state p JOIN media_file f ON f.id = p.file_id
          WHERE f.kind IN ('movie', 'episode', 'video') AND f.title_key IS NOT NULL AND (p.last_played_at IS NOT NULL OR p.watched = 1)
          GROUP BY f.title_key ORDER BY activity DESC, f.title_key LIMIT ?`,
      )
      .all(limit * 3) as { key: string; kind: MediaKind; activity: string }[]

    const picked: { key: string; fileId: number; label: string | null; activity: string }[] = []
    for (const c of candidates) {
      if (picked.length >= limit) break
      if (c.kind === 'episode') {
        const next = nextEpisode(this.episodeFiles(c.key))
        if (next) picked.push({ key: c.key, fileId: next.fileId, label: next.label, activity: c.activity })
        continue
      }
      // A film or personal video: continue it unless it has been marked watched.
      const files = this.raw
        .prepare(
          `SELECT f.id, f.season, f.episode, p.watched AS watched, f.state, s.availability, p.last_played_at AS played
             FROM media_file f JOIN library_source s ON s.id = f.source_id LEFT JOIN playback_state p ON p.file_id = f.id
            WHERE f.title_key = ? AND f.kind = ? ORDER BY p.last_played_at DESC`,
        )
        .all(c.key, c.kind) as (FileRow & { played: string | null })[]
      if (files.length === 0 || files.some((f) => f.watched === 1)) continue
      const best = files.find((f) => toEpisodeFile(f).available) ?? files[0]!
      picked.push({ key: c.key, fileId: best.id, label: null, activity: c.activity })
    }

    const summaries = this.titles.summaries(picked.map((p) => p.key))
    return picked.flatMap((p) => {
      const summary = summaries.get(p.key)
      return summary ? [{ summary, fileId: p.fileId, label: p.label, lastActivityAt: p.activity }] : []
    })
  }
}
