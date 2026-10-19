import type Database from 'better-sqlite3'
import {
  MatchCandidate,
  type EpisodeInfo,
  type MatchKind,
  type MatchState,
  type TitleMatch,
  type TitleMetadata,
} from '@theama/contracts'
import { z } from 'zod'
import { artworkUrl } from './artwork'
import type { ProviderEpisode, ProviderTitle } from './provider'

export interface PendingTitle {
  key: string
  kind: MatchKind
  /** Best guess of the title from the file names. */
  title: string
  year: number | null
}

export interface StoredMatch extends TitleMatch {
  key: string
  kind: MatchKind
  attempts: number
  attemptedAt: string
}

interface MatchRow {
  title_key: string
  kind: MatchKind
  state: MatchState
  provider: string | null
  external_id: string | null
  score: number | null
  candidates: string | null
  decided_by: 'auto' | 'user'
  locked: number
  attempts: number
  attempted_at: string
}

const Candidates = z.array(MatchCandidate)

function parseCandidates(raw: string | null): MatchCandidate[] {
  if (!raw) return []
  try {
    const r = Candidates.safeParse(JSON.parse(raw))
    return r.success ? r.data : []
  } catch {
    return []
  }
}

function toMatch(r: MatchRow): StoredMatch {
  return {
    key: r.title_key,
    kind: r.kind,
    state: r.state,
    decidedBy: r.decided_by,
    locked: r.locked === 1,
    score: r.score,
    provider: r.provider,
    externalId: r.external_id,
    candidates: parseCandidates(r.candidates),
    attempts: r.attempts,
    attemptedAt: r.attempted_at,
  }
}

export interface MatchWrite {
  key: string
  kind: MatchKind
  state: MatchState
  provider?: string | null
  externalId?: string | null
  score?: number | null
  signals?: unknown
  candidates?: MatchCandidate[]
  decidedBy: 'auto' | 'user'
  locked?: boolean
}

export interface MetadataWrite {
  key: string
  provider: string
  language: string
  title: ProviderTitle
  posterFile: string | null
  backdropFile: string | null
}

export interface MetadataCounts {
  matched: number
  ambiguous: number
  unmatched: number
  pending: number
}

/** Matches and provider data, kept apart from the files so rescans and refreshes cannot disturb them. */
export class MetadataRepo {
  constructor(private readonly raw: Database.Database) {}

  /** Runs several writes as one: either all of them land or none. */
  atomic<T>(fn: () => T): T {
    return this.raw.transaction(fn)()
  }

  /** Drops the decision (not the files) so the title is looked up again from scratch. */
  forget(key: string): void {
    this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM title_match WHERE title_key = ?').run(key)
      this.raw.prepare('DELETE FROM title_metadata WHERE title_key = ?').run(key)
      this.raw.prepare('DELETE FROM episode_metadata WHERE title_key = ?').run(key)
    })()
  }

  getMatch(key: string): StoredMatch | null {
    const r = this.raw.prepare('SELECT * FROM title_match WHERE title_key = ?').get(key) as MatchRow | undefined
    return r ? toMatch(r) : null
  }

  /** Records a decision. A locked row is only replaced by another decision from the user. */
  saveMatch(w: MatchWrite, now: string): void {
    const existing = this.raw.prepare('SELECT locked, attempts FROM title_match WHERE title_key = ?').get(w.key) as
      | { locked: number; attempts: number }
      | undefined
    if (existing?.locked === 1 && w.decidedBy !== 'user') return
    this.raw
      .prepare(
        `INSERT INTO title_match (title_key, kind, state, provider, external_id, score, signals, candidates, decided_by, locked, attempts, attempted_at, updated_at)
         VALUES (@key, @kind, @state, @provider, @externalId, @score, @signals, @candidates, @decidedBy, @locked, @attempts, @now, @now)
         ON CONFLICT(title_key) DO UPDATE SET kind = @kind, state = @state, provider = @provider, external_id = @externalId,
           score = @score, signals = @signals, candidates = @candidates, decided_by = @decidedBy, locked = @locked,
           attempts = @attempts, attempted_at = @now, updated_at = @now`,
      )
      .run({
        key: w.key,
        kind: w.kind,
        state: w.state,
        provider: w.provider ?? null,
        externalId: w.externalId ?? null,
        score: w.score ?? null,
        signals: w.signals === undefined ? null : JSON.stringify(w.signals),
        candidates: w.candidates?.length ? JSON.stringify(w.candidates) : null,
        decidedBy: w.decidedBy,
        locked: w.locked ? 1 : 0,
        attempts: (existing?.attempts ?? 0) + 1,
        now,
      })
  }

  /** Unlocks a match so the next automatic pass may reconsider it. */
  setLocked(key: string, locked: boolean, now: string): boolean {
    return this.raw.prepare('UPDATE title_match SET locked = ?, updated_at = ? WHERE title_key = ?').run(locked ? 1 : 0, now, key).changes > 0
  }

  /** Forgets everything the provider said about a title (the match row is rewritten by the caller). */
  clearMetadata(key: string): void {
    this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM title_metadata WHERE title_key = ?').run(key)
      this.raw.prepare('DELETE FROM episode_metadata WHERE title_key = ?').run(key)
    })()
  }

  saveMetadata(w: MetadataWrite, episodes: ProviderEpisode[], stills: Map<string, string | null>, now: string): void {
    const t = w.title
    this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT OR REPLACE INTO title_metadata (title_key, provider, external_id, language, title, original_title, year, tagline,
             overview, runtime_min, genres, rating, votes, poster_path, poster_file, backdrop_path, backdrop_file, cast_json,
             imdb_id, status, fetched_at)
           VALUES (@key, @provider, @externalId, @language, @title, @originalTitle, @year, @tagline, @overview, @runtime, @genres,
             @rating, @votes, @posterPath, @posterFile, @backdropPath, @backdropFile, @cast, @imdb, @status, @now)`,
        )
        .run({
          key: w.key,
          provider: w.provider,
          externalId: t.externalId,
          language: w.language,
          title: t.title,
          originalTitle: t.originalTitle,
          year: t.year,
          tagline: t.tagline,
          overview: t.overview,
          runtime: t.runtimeMinutes,
          genres: JSON.stringify(t.genres),
          rating: t.rating?.value ?? null,
          votes: t.rating?.votes ?? null,
          posterPath: t.posterPath,
          posterFile: w.posterFile,
          backdropPath: t.backdropPath,
          backdropFile: w.backdropFile,
          cast: JSON.stringify(t.cast),
          imdb: t.imdbId,
          status: t.status,
          now,
        })
      this.raw.prepare('DELETE FROM episode_metadata WHERE title_key = ?').run(w.key)
      const insert = this.raw.prepare(
        `INSERT OR REPLACE INTO episode_metadata (title_key, season, episode, name, overview, air_date, runtime_min, still_path, still_file)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const e of episodes) {
        insert.run(w.key, e.season, e.episode, e.name, e.overview, e.airDate, e.runtimeMinutes, e.stillPath, stills.get(`${e.season}:${e.episode}`) ?? null)
      }
    })()
  }

  getMetadata(key: string): TitleMetadata | null {
    const r = this.raw.prepare('SELECT * FROM title_metadata WHERE title_key = ?').get(key) as
      | Record<string, string | number | null>
      | undefined
    if (!r) return null
    const parseArray = <T>(raw: unknown, fallback: T[]): T[] => {
      try {
        const v: unknown = JSON.parse(String(raw))
        return Array.isArray(v) ? (v as T[]) : fallback
      } catch {
        return fallback
      }
    }
    return {
      provider: String(r.provider),
      externalId: String(r.external_id),
      title: String(r.title),
      originalTitle: (r.original_title as string | null) ?? null,
      year: (r.year as number | null) ?? null,
      tagline: (r.tagline as string | null) ?? null,
      overview: (r.overview as string | null) ?? null,
      runtimeMinutes: (r.runtime_min as number | null) ?? null,
      genres: parseArray<string>(r.genres, []),
      // The rating carries the name of whoever gave it, so the UI can never mislabel it.
      rating: r.rating === null || r.rating === undefined ? null : { source: String(r.provider), value: Number(r.rating), votes: Number(r.votes ?? 0) },
      posterUrl: artworkUrl((r.poster_file as string | null) ?? null),
      backdropUrl: artworkUrl((r.backdrop_file as string | null) ?? null),
      cast: parseArray<{ name: string; character: string | null }>(r.cast_json, []),
      imdbId: (r.imdb_id as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      language: String(r.language),
      fetchedAt: String(r.fetched_at),
    }
  }

  episodes(key: string): EpisodeInfo[] {
    const rows = this.raw
      .prepare('SELECT season, episode, name, overview, air_date, runtime_min, still_file FROM episode_metadata WHERE title_key = ? ORDER BY season, episode')
      .all(key) as {
      season: number
      episode: number
      name: string | null
      overview: string | null
      air_date: string | null
      runtime_min: number | null
      still_file: string | null
    }[]
    return rows.map((r) => ({
      season: r.season,
      episode: r.episode,
      name: r.name,
      overview: r.overview,
      airDate: r.air_date,
      runtimeMinutes: r.runtime_min,
      stillUrl: artworkUrl(r.still_file),
    }))
  }

  /**
   * Titles that have files but no decision yet, plus unmatched ones not tried for `retryUnmatchedBefore`.
   * Personal videos and extras are never looked up. Newest first, so a freshly added folder fills in first.
   */
  pending(retryUnmatchedBefore: string, limit: number): PendingTitle[] {
    const rows = this.raw
      .prepare(
        `SELECT f.title_key AS key, f.kind AS kind, MIN(f.guessed_title COLLATE BINARY) AS title, MAX(f.guessed_year) AS year
         FROM media_file f LEFT JOIN title_match m ON m.title_key = f.title_key
         WHERE f.kind IN ('movie','episode') AND f.title_key IS NOT NULL
           AND (m.title_key IS NULL OR (m.state = 'unmatched' AND m.locked = 0 AND m.attempted_at < ?))
         GROUP BY f.title_key ORDER BY MAX(f.first_seen_at) DESC, f.title_key LIMIT ?`,
      )
      .all(retryUnmatchedBefore, limit) as { key: string; kind: 'movie' | 'episode'; title: string; year: number | null }[]
    return rows.map((r) => ({ key: r.key, kind: r.kind === 'episode' ? 'series' : 'movie', title: r.title, year: r.year }))
  }

  /** Matched titles whose provider data is missing or was fetched in another language. */
  stale(language: string, limit: number): { key: string; kind: MatchKind; externalId: string }[] {
    const rows = this.raw
      .prepare(
        `SELECT m.title_key AS key, m.kind AS kind, m.external_id AS externalId
         FROM title_match m LEFT JOIN title_metadata d ON d.title_key = m.title_key
         WHERE m.state = 'matched' AND m.external_id IS NOT NULL AND (d.title_key IS NULL OR d.language <> ?)
           AND EXISTS (SELECT 1 FROM media_file f WHERE f.title_key = m.title_key)
         LIMIT ?`,
      )
      .all(language, limit) as { key: string; kind: MatchKind; externalId: string }[]
    return rows
  }

  /** Images that failed to download earlier, to be tried again. */
  missingArtwork(limit: number): { key: string; posterPath: string | null; backdropPath: string | null; needPoster: boolean; needBackdrop: boolean }[] {
    const rows = this.raw
      .prepare(
        `SELECT title_key AS key, poster_path, backdrop_path, poster_file, backdrop_file FROM title_metadata
         WHERE (poster_path IS NOT NULL AND poster_file IS NULL) OR (backdrop_path IS NOT NULL AND backdrop_file IS NULL) LIMIT ?`,
      )
      .all(limit) as { key: string; poster_path: string | null; backdrop_path: string | null; poster_file: string | null; backdrop_file: string | null }[]
    return rows.map((r) => ({
      key: r.key,
      posterPath: r.poster_path,
      backdropPath: r.backdrop_path,
      needPoster: r.poster_path !== null && r.poster_file === null,
      needBackdrop: r.backdrop_path !== null && r.backdrop_file === null,
    }))
  }

  setArtworkFiles(key: string, poster: string | null, backdrop: string | null): void {
    this.raw
      .prepare('UPDATE title_metadata SET poster_file = coalesce(?, poster_file), backdrop_file = coalesce(?, backdrop_file) WHERE title_key = ?')
      .run(poster, backdrop, key)
  }

  missingStills(limit: number): { key: string; season: number; episode: number; stillPath: string }[] {
    return (
      this.raw
        .prepare(
          `SELECT title_key AS key, season, episode, still_path AS stillPath FROM episode_metadata
           WHERE still_path IS NOT NULL AND still_file IS NULL LIMIT ?`,
        )
        .all(limit) as { key: string; season: number; episode: number; stillPath: string }[]
    )
  }

  setStillFile(key: string, season: number, episode: number, file: string): void {
    this.raw.prepare('UPDATE episode_metadata SET still_file = ? WHERE title_key = ? AND season = ? AND episode = ?').run(file, key, season, episode)
  }

  counts(retryUnmatchedBefore: string): MetadataCounts {
    const rows = this.raw
      .prepare(
        `SELECT m.state AS state, COUNT(*) AS n FROM title_match m
         WHERE EXISTS (SELECT 1 FROM media_file f WHERE f.title_key = m.title_key) GROUP BY m.state`,
      )
      .all() as { state: MatchState; n: number }[]
    const by = (s: MatchState): number => rows.find((r) => r.state === s)?.n ?? 0
    const pending = (
      this.raw
        .prepare(
          `SELECT COUNT(*) AS n FROM (
             SELECT 1 FROM media_file f LEFT JOIN title_match m ON m.title_key = f.title_key
             WHERE f.kind IN ('movie','episode') AND f.title_key IS NOT NULL
               AND (m.title_key IS NULL OR (m.state = 'unmatched' AND m.locked = 0 AND m.attempted_at < ?))
             GROUP BY f.title_key)`,
        )
        .get(retryUnmatchedBefore) as { n: number }
    ).n
    return { matched: by('matched'), ambiguous: by('ambiguous'), unmatched: by('unmatched'), pending }
  }

  /** Drops automatic results for titles that no longer have any file (renamed away or folder removed). */
  pruneOrphans(): number {
    const orphan = `NOT EXISTS (SELECT 1 FROM media_file f WHERE f.title_key = title_key_col)`
    let removed = 0
    this.raw.transaction(() => {
      const keys = (
        this.raw
          .prepare(
            `SELECT m.title_key AS k FROM title_match m
             WHERE m.locked = 0 AND m.decided_by = 'auto' AND ${orphan.replace('title_key_col', 'm.title_key')}`,
          )
          .all() as { k: string }[]
      ).map((r) => r.k)
      for (const k of keys) {
        this.raw.prepare('DELETE FROM title_match WHERE title_key = ?').run(k)
        this.raw.prepare('DELETE FROM title_metadata WHERE title_key = ?').run(k)
        this.raw.prepare('DELETE FROM episode_metadata WHERE title_key = ?').run(k)
        removed++
      }
    })()
    return removed
  }
}
