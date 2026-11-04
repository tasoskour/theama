import type Database from 'better-sqlite3'
import type {
  CollectionDetail,
  CollectionKind,
  CollectionMember,
  CollectionOrder,
  CollectionSummary,
  TitleSummary,
} from '@theama/contracts'
import { artworkUrl } from '../metadata/artwork'
import type { ProviderCollection } from '../metadata/provider'
import { normaliseTitle } from '../scan/filename'
import type { TitleRepo } from '../scan/titles'

interface CollectionRow {
  id: number
  kind: CollectionKind
  provider: string | null
  external_id: string | null
  name: string
  overview: string | null
  poster_file: string | null
  backdrop_file: string | null
  fetched_at: string | null
  rating_enriched: number
}

interface MemberRow {
  id: number
  title_key: string | null
  external_id: string | null
  title: string
  year: number | null
  release_date: string | null
  overview: string | null
  poster_file: string | null
  rating: number | null
  custom_order: number | null
  /** The library title this member is, if it is in the library. */
  local_key: string | null
}

export interface OfficialArtwork {
  poster: string | null
  backdrop: string | null
  /** Provider movie id -> cached poster file. */
  parts: Map<string, string | null>
}

export type MissingArtwork = { target: 'collection_poster' | 'collection_backdrop' | 'member_poster'; id: number; path: string }

/** A user collection that does not exist, a title that is not in the library, a duplicate: told apart for the API. */
export class CollectionProblem extends Error {
  constructor(
    readonly code: 'not_found' | 'not_editable' | 'unknown_title' | 'duplicate_name' | 'bad_order',
    message: string,
  ) {
    super(message)
  }
}

const byDateThenTitle = (a: MemberView, b: MemberView): number =>
  (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })

interface MemberView {
  row: MemberRow
  summary: TitleSummary | null
  title: string
  date: string | null
}

/**
 * Collections: the provider's official sets (read-only, refreshed from the provider) and the person's own.
 * Whether a member is in the library is worked out when reading, so identifying a title later links it
 * with no extra step, and a member whose files are gone stays listed as a plain, non-playable entry.
 */
export class CollectionRepo {
  constructor(
    private readonly raw: Database.Database,
    private readonly titles: TitleRepo,
  ) {}

  // --- official (from the provider) --------------------------------------

  getOfficial(provider: string, externalId: string): { id: number; fetchedAt: string | null } | null {
    const r = this.raw.prepare("SELECT id, fetched_at FROM collection WHERE kind = 'official' AND provider = ? AND external_id = ?").get(provider, externalId) as
      | { id: number; fetched_at: string | null }
      | undefined
    return r ? { id: r.id, fetchedAt: r.fetched_at } : null
  }

  /** Stores (or refreshes) an official collection and replaces its member list with the provider's. */
  upsertOfficial(provider: string, c: ProviderCollection, art: OfficialArtwork, now: string): number {
    return this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO collection (kind, provider, external_id, name, overview, poster_path, poster_file, backdrop_path, backdrop_file, fetched_at, created_at, updated_at, rating_enriched)
           VALUES ('official', @provider, @externalId, @name, @overview, @posterPath, @posterFile, @backdropPath, @backdropFile, @now, @now, @now, 1)
           ON CONFLICT(provider, external_id) WHERE provider IS NOT NULL DO UPDATE SET
             name = @name, overview = @overview, poster_path = @posterPath, backdrop_path = @backdropPath,
             poster_file = coalesce(@posterFile, CASE WHEN poster_path = @posterPath THEN poster_file END),
             backdrop_file = coalesce(@backdropFile, CASE WHEN backdrop_path = @backdropPath THEN backdrop_file END),
             fetched_at = @now, updated_at = @now, rating_enriched = 1`,
        )
        .run({
          provider,
          externalId: c.externalId,
          name: c.name,
          overview: c.overview,
          posterPath: c.posterPath,
          posterFile: art.poster,
          backdropPath: c.backdropPath,
          backdropFile: art.backdrop,
          now,
        })
      const id = (this.raw.prepare("SELECT id FROM collection WHERE provider = ? AND external_id = ? AND kind = 'official'").get(provider, c.externalId) as { id: number }).id
      const keep = c.parts.map((p) => p.externalId)
      const existing = this.raw.prepare('SELECT external_id FROM collection_member WHERE collection_id = ? AND external_id IS NOT NULL').all(id) as { external_id: string }[]
      const del = this.raw.prepare('DELETE FROM collection_member WHERE collection_id = ? AND external_id = ?')
      for (const e of existing) if (!keep.includes(e.external_id)) del.run(id, e.external_id)
      const upsert = this.raw.prepare(
        `INSERT INTO collection_member (collection_id, external_id, title, year, release_date, overview, poster_path, poster_file, rating)
         VALUES (@id, @externalId, @title, @year, @releaseDate, @overview, @posterPath, @posterFile, @rating)
         ON CONFLICT(collection_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
           title = @title, year = @year, release_date = @releaseDate, overview = @overview, poster_path = @posterPath,
           poster_file = coalesce(@posterFile, CASE WHEN poster_path = @posterPath THEN poster_file END), rating = @rating`,
      )
      for (const p of c.parts) {
        upsert.run({
          id,
          externalId: p.externalId,
          title: p.title,
          year: p.year,
          releaseDate: p.releaseDate,
          overview: p.overview,
          posterPath: p.posterPath,
          posterFile: art.parts.get(p.externalId) ?? null,
          rating: p.rating,
        })
      }
      return id
    })()
  }

  /** Images that could not be downloaded earlier (offline CDN, interrupted run). */
  missingArtwork(limit: number): MissingArtwork[] {
    const out: MissingArtwork[] = []
    const q = (sql: string, target: MissingArtwork['target']): void => {
      for (const r of this.raw.prepare(sql).all(limit) as { id: number; path: string }[]) out.push({ target, id: r.id, path: r.path })
    }
    q('SELECT id, poster_path AS path FROM collection WHERE poster_path IS NOT NULL AND poster_file IS NULL LIMIT ?', 'collection_poster')
    q('SELECT id, backdrop_path AS path FROM collection WHERE backdrop_path IS NOT NULL AND backdrop_file IS NULL LIMIT ?', 'collection_backdrop')
    q('SELECT id, poster_path AS path FROM collection_member WHERE poster_path IS NOT NULL AND poster_file IS NULL LIMIT ?', 'member_poster')
    return out.slice(0, limit)
  }

  setArtworkFile(target: MissingArtwork['target'], id: number, file: string): void {
    const sql = {
      collection_poster: 'UPDATE collection SET poster_file = ? WHERE id = ?',
      collection_backdrop: 'UPDATE collection SET backdrop_file = ? WHERE id = ?',
      member_poster: 'UPDATE collection_member SET poster_file = ? WHERE id = ?',
    }[target]
    this.raw.prepare(sql).run(file, id)
  }

  // --- reading ------------------------------------------------------------

  private collectionRow(id: number): CollectionRow | undefined {
    return this.raw.prepare('SELECT id, kind, provider, external_id, name, overview, poster_file, backdrop_file, fetched_at, rating_enriched FROM collection WHERE id = ?').get(id) as
      | CollectionRow
      | undefined
  }

  private memberRows(c: CollectionRow): MemberRow[] {
    if (c.kind === 'official') {
      return this.raw
        .prepare(
          `SELECT m.id, m.title_key, m.external_id, m.title, m.year, m.release_date, m.overview, m.poster_file, m.rating, m.custom_order,
                  (SELECT tm.title_key FROM title_match tm
                    WHERE tm.state = 'matched' AND tm.kind = 'movie' AND tm.provider = @provider AND tm.external_id = m.external_id
                      AND EXISTS (SELECT 1 FROM media_file f WHERE f.title_key = tm.title_key)
                    ORDER BY tm.title_key LIMIT 1) AS local_key
             FROM collection_member m WHERE m.collection_id = @id`,
        )
        .all({ id: c.id, provider: c.provider }) as MemberRow[]
    }
    return this.raw
      .prepare(
        `SELECT m.id, m.title_key, m.external_id, m.title, m.year, m.release_date, m.overview, m.poster_file, m.rating, m.custom_order,
                CASE WHEN EXISTS (SELECT 1 FROM media_file f WHERE f.title_key = m.title_key AND f.kind <> 'extra') THEN m.title_key END AS local_key
           FROM collection_member m WHERE m.collection_id = ?`,
      )
      .all(c.id) as MemberRow[]
  }

  private views(rows: MemberRow[]): MemberView[] {
    return this.viewsFrom(rows, this.titles.summaries(rows.flatMap((r) => (r.local_key ? [r.local_key] : []))))
  }

  private viewsFrom(rows: MemberRow[], summaries: Map<string, TitleSummary>): MemberView[] {
    return rows.map((row) => {
      const summary = row.local_key ? (summaries.get(row.local_key) ?? null) : null
      return { row, summary, title: summary?.title ?? row.title, date: row.release_date ?? (summary?.year ? `${summary.year}` : row.year ? `${row.year}` : null) }
    })
  }

  private static orders(kind: CollectionKind): CollectionOrder[] {
    return kind === 'user' ? ['custom', 'release'] : ['release']
  }

  private static sort(views: MemberView[], order: CollectionOrder): MemberView[] {
    if (order === 'custom') {
      return [...views].sort((a, b) => (a.row.custom_order ?? 1e9) - (b.row.custom_order ?? 1e9) || a.row.id - b.row.id)
    }
    return [...views].sort(byDateThenTitle)
  }

  private summaryOf(c: CollectionRow, sorted: MemberView[]): CollectionSummary {
    const local = sorted.filter((v) => v.summary)
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      overview: c.overview,
      memberCount: sorted.length,
      localCount: local.length,
      posterUrl: artworkUrl(c.poster_file),
      previewPosters: local.flatMap((v) => (v.summary?.posterUrl ? [v.summary.posterUrl] : [])).slice(0, 4),
    }
  }

  /** Official collections show only when something in them is in the library; the person's own always show. */
  list(kind?: CollectionKind, q?: string): CollectionSummary[] {
    const words = q ? normaliseTitle(q).split(' ').filter(Boolean) : []
    const rows = (
      this.raw
        .prepare(`SELECT id, kind, provider, external_id, name, overview, poster_file, backdrop_file, fetched_at, rating_enriched FROM collection ${kind ? 'WHERE kind = ?' : ''} ORDER BY name COLLATE NOCASE, id`)
        .all(...(kind ? [kind] : [])) as CollectionRow[]
    ).filter((c) => {
      const name = normaliseTitle(c.name)
      return words.every((w) => name.includes(w))
    })
    // Look up the library cards of every collection's members in one go, not once per collection.
    const members = new Map(rows.map((c) => [c.id, this.memberRows(c)]))
    const cards = this.titles.summaries([...new Set([...members.values()].flatMap((m) => m.flatMap((r) => (r.local_key ? [r.local_key] : []))))])
    const out: CollectionSummary[] = []
    for (const c of rows) {
      const order = CollectionRepo.orders(c.kind)[0]!
      const sorted = CollectionRepo.sort(this.viewsFrom(members.get(c.id)!, cards), order)
      const s = this.summaryOf(c, sorted)
      if (c.kind === 'official' && s.localCount === 0) continue
      out.push(s)
    }
    return out
  }

  detail(id: number, requested?: CollectionOrder): CollectionDetail | null {
    const c = this.collectionRow(id)
    if (!c) return null
    const orders = CollectionRepo.orders(c.kind)
    const order = requested && orders.includes(requested) ? requested : orders[0]!
    const sorted = CollectionRepo.sort(this.views(this.memberRows(c)), order)
    const members: CollectionMember[] = sorted.map((v, i) => ({
      position: i + 1,
      key: v.summary?.key ?? null,
      titleKey: v.row.title_key,
      title: v.title,
      year: v.summary?.year ?? v.row.year,
      releaseDate: v.row.release_date,
      overview: v.row.overview,
      posterUrl: v.summary?.posterUrl ?? artworkUrl(v.row.poster_file),
      provider: c.kind === 'official' ? c.provider : null,
      externalId: c.kind === 'official' ? v.row.external_id : null,
      rating: v.summary?.rating ?? v.row.rating,
      summary: v.summary,
    }))
    return { summary: this.summaryOf(c, sorted), backdropUrl: artworkUrl(c.backdrop_file), orders, order, members }
  }

  /** Older official sets are refreshed only when viewed, leaving the cached page available immediately. */
  ratingRefreshTarget(id: number): { externalId: string; name: string } | null {
    const c = this.collectionRow(id)
    return c?.kind === 'official' && c.rating_enriched === 0 && c.external_id
      ? { externalId: c.external_id, name: c.name }
      : null
  }

  // --- the person's own collections ----------------------------------------

  private userCollection(id: number): CollectionRow {
    const c = this.collectionRow(id)
    if (!c) throw new CollectionProblem('not_found', 'No such collection')
    if (c.kind !== 'user') throw new CollectionProblem('not_editable', 'Official collections cannot be edited')
    return c
  }

  private assertFreeName(name: string, exceptId?: number): void {
    const clash = this.raw.prepare("SELECT id FROM collection WHERE kind = 'user' AND lower(name) = lower(?) AND id <> ?").get(name, exceptId ?? -1)
    if (clash) throw new CollectionProblem('duplicate_name', 'You already have a collection with that name')
  }

  create(name: string, now: string, firstKey?: string): number {
    this.assertFreeName(name)
    return this.raw.transaction(() => {
      const id = Number(
        this.raw.prepare("INSERT INTO collection (kind, name, created_at, updated_at) VALUES ('user', ?, ?, ?)").run(name, now, now).lastInsertRowid,
      )
      if (firstKey) this.addMember(id, firstKey, now)
      return id
    })()
  }

  rename(id: number, name: string, now: string): void {
    this.userCollection(id)
    this.assertFreeName(name, id)
    this.raw.prepare('UPDATE collection SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id)
  }

  /** Removes the collection and its memberships only; the titles and their files are untouched. */
  remove(id: number): void {
    this.userCollection(id)
    this.raw.prepare('DELETE FROM collection WHERE id = ?').run(id)
  }

  addMember(id: number, key: string, now: string): void {
    this.userCollection(id)
    const summary = this.titles.summaries([key]).get(key)
    if (!summary) throw new CollectionProblem('unknown_title', 'That title is not in your library')
    this.raw.transaction(() => {
      const exists = this.raw.prepare('SELECT 1 FROM collection_member WHERE collection_id = ? AND title_key = ?').get(id, key)
      if (exists) return
      const next = (this.raw.prepare('SELECT coalesce(max(custom_order), -1) + 1 AS n FROM collection_member WHERE collection_id = ?').get(id) as { n: number }).n
      this.raw
        .prepare('INSERT INTO collection_member (collection_id, title_key, title, year, custom_order) VALUES (?, ?, ?, ?, ?)')
        .run(id, key, summary.title, summary.year, next)
      this.raw.prepare('UPDATE collection SET updated_at = ? WHERE id = ?').run(now, id)
    })()
  }

  removeMember(id: number, key: string, now: string): void {
    this.userCollection(id)
    this.raw.transaction(() => {
      this.raw.prepare('DELETE FROM collection_member WHERE collection_id = ? AND title_key = ?').run(id, key)
      this.raw.prepare('UPDATE collection SET updated_at = ? WHERE id = ?').run(now, id)
    })()
  }

  /** Sets the custom order. Members not named keep their relative order after the named ones. */
  reorder(id: number, keys: readonly string[], now: string): void {
    this.userCollection(id)
    this.raw.transaction(() => {
      const members = this.raw.prepare('SELECT id, title_key FROM collection_member WHERE collection_id = ? ORDER BY coalesce(custom_order, 1000000), id').all(id) as { id: number; title_key: string }[]
      const known = new Set(members.map((m) => m.title_key))
      if (new Set(keys).size !== keys.length || keys.some((k) => !known.has(k))) {
        throw new CollectionProblem('bad_order', 'The order names a title twice or one that is not in the collection')
      }
      const rank = new Map(keys.map((k, i) => [k, i]))
      const rest = members.filter((m) => !rank.has(m.title_key))
      const set = this.raw.prepare('UPDATE collection_member SET custom_order = ? WHERE id = ?')
      keys.forEach((k, i) => set.run(i, members.find((m) => m.title_key === k)!.id))
      rest.forEach((m, i) => set.run(keys.length + i, m.id))
      this.raw.prepare('UPDATE collection SET updated_at = ? WHERE id = ?').run(now, id)
    })()
  }
}
