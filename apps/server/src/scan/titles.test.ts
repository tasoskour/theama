import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MediaKind } from '@theama/contracts'
import { openDatabase, type DbHandle } from '../db/client'
import { LibrarySourceRepo } from '../library/sources'
import { ftsQuery } from './fts'
import { normaliseTitle, titleKeyFor } from './filename'
import { MediaFileRepo, type NewFileRow } from './store'
import { TitleRepo } from './titles'

let handle: DbHandle
let library: LibrarySourceRepo
let files: MediaFileRepo
let titles: TitleRepo
let sourceId: number

beforeEach(() => {
  handle = openDatabase(':memory:')
  library = new LibrarySourceRepo(handle.db)
  files = new MediaFileRepo(handle.db, handle.raw)
  titles = new TitleRepo(handle.raw)
  sourceId = library.create({ path: 'D:\\Media', libraryType: 'auto', recursive: true, volumeId: '1' }).id
})
afterEach(() => handle.close())

let n = 0
function add(
  kind: MediaKind,
  title: string,
  extra: Partial<NewFileRow> & { addedAt?: string } = {},
): number {
  const path = extra.path ?? `D:\\Media\\${title.replace(/[^\p{L}\p{N}]+/gu, '.')}.${++n}.mkv`
  const when = extra.addedAt ?? '2025-01-01T00:00:00.000Z'
  const [id] = files.insertMany([
    {
      sourceId, path, size: 1000, mtimeMs: 1, state: 'available', firstSeenAt: when, lastSeenAt: when,
      kind, guessedTitle: title, guessedYear: extra.guessedYear ?? null, season: extra.season ?? null,
      episode: extra.episode ?? null, episodeEnd: null, episodeTitle: extra.episodeTitle ?? null,
      titleKey: titleKeyFor(kind, title, extra.guessedYear ?? null, path),
      ...extra,
    },
  ])
  return id!
}

describe('library provider identities', () => {
  it('tracks exact matched identities with visible files, including partial series on offline drives', () => {
    const movie = add('movie', 'Movie')
    const episode = add('episode', 'Series', { season: 1, episode: 1 })
    const unmatched = add('movie', 'Unmatched')
    const match = handle.raw.prepare(`INSERT INTO title_match (title_key, kind, state, provider, external_id, decided_by, attempted_at, updated_at)
      SELECT title_key, ?, ?, 'tmdb', '42', 'user', 'now', 'now' FROM media_file WHERE id = ?`)
    match.run('movie', 'matched', movie)
    match.run('series', 'matched', episode)
    match.run('movie', 'ambiguous', unmatched)
    const expected = [{ provider: 'tmdb', kind: 'movie', externalId: '42' }, { provider: 'tmdb', kind: 'series', externalId: '42' }]
    expect(titles.identities()).toEqual(expect.arrayContaining(expected))
    expect(titles.identities()).toHaveLength(2)
    handle.raw.prepare("UPDATE library_source SET availability = 'offline' WHERE id = ?").run(sourceId)
    handle.raw.prepare("UPDATE media_file SET state = 'missing_unconfirmed' WHERE id = ?").run(episode)
    expect(titles.identities()).toHaveLength(2)
    handle.raw.prepare('UPDATE media_file SET excluded = 1 WHERE id = ?').run(movie)
    expect(titles.identities()).toEqual([expected[1]])
    handle.raw.prepare("UPDATE title_match SET state = 'unmatched' WHERE kind = 'series'").run()
    expect(titles.identities()).toEqual([])
    handle.raw.prepare("UPDATE title_match SET state = 'matched' WHERE kind = 'series'").run()
    handle.raw.prepare('DELETE FROM media_file WHERE id = ?').run(episode)
    expect(titles.identities()).toEqual([])
  })
})

describe('title keys', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normaliseTitle("X-Men '97")).toBe('x men 97')
    expect(normaliseTitle('Ταινία ΜΕ τόνους')).toBe(normaliseTitle('ταινια με τονους'))
    expect(normaliseTitle('Amélie')).toBe('amelie')
  })
  it('groups episodes of a series, separates movies by year and keeps personal videos apart', () => {
    expect(titleKeyFor('episode', 'The Legend of Vox Machina', null, 'a')).toBe(titleKeyFor('episode', 'the legend of vox machina', 2022, 'b'))
    expect(titleKeyFor('movie', 'Dune', 1984, 'a')).not.toBe(titleKeyFor('movie', 'Dune', 2021, 'a'))
    expect(titleKeyFor('video', 'Trip', null, 'D:\\a.mp4')).not.toBe(titleKeyFor('video', 'Trip', null, 'D:\\b.mp4'))
  })
})

describe('ftsQuery', () => {
  it('turns words into AND-ed, folded prefix terms and survives hostile input', () => {
    expect(ftsQuery('ΤΑΙΝΊΕΣ')).toBe('"ταινιεσ"*')
    expect(ftsQuery('sev')).toBe('"sev"*')
    expect(ftsQuery('Half  Loop')).toBe('"half"* "loop"*')
    expect(ftsQuery('a" OR "b')).toBe('"a"* "or"* "b"*')
    expect(ftsQuery('!!! ---')).toBeNull()
    expect(ftsQuery('NEAR(x) *')).toBe('"near"* "x"*')
  })
})

describe('TitleRepo.list', () => {
  beforeEach(() => {
    for (let e = 1; e <= 3; e++) add('episode', 'Severance', { season: 1, episode: e, episodeTitle: ['Good News About Hell', 'Half Loop', 'In Perpetuity'][e - 1]!, addedAt: '2025-03-01T00:00:00.000Z' })
    add('episode', 'severance', { season: 2, episode: 1, addedAt: '2025-03-05T00:00:00.000Z' })
    add('movie', 'Interstellar', { guessedYear: 2014, addedAt: '2025-02-01T00:00:00.000Z' })
    add('movie', 'Dune', { guessedYear: 1984, addedAt: '2025-02-02T00:00:00.000Z' })
    add('movie', 'Dune', { guessedYear: 2021, addedAt: '2025-02-03T00:00:00.000Z' })
    add('movie', 'Η Ταινία', { guessedYear: 2020, addedAt: '2025-02-04T00:00:00.000Z' })
    add('video', 'Trip to Crete', { addedAt: '2025-01-15T00:00:00.000Z' })
    add('extra', 'Making of Severance', { addedAt: '2025-01-16T00:00:00.000Z' })
  })

  it('groups episodes into one series with counts, and hides extras', () => {
    const all = titles.list({})
    expect(all.total).toBe(6)
    const series = all.items.find((t) => t.kind === 'series')!
    expect(series).toMatchObject({ title: 'Severance', fileCount: 4, episodeCount: 4, seasonCount: 2, availableCount: 4 })
    expect(all.items.some((t) => t.title.startsWith('Making'))).toBe(false)
  })

  it('treats the same movie title with different years as different movies', () => {
    const dunes = titles.list({ kind: 'movie', q: 'dune' })
    expect(dunes.items.map((t) => t.year).sort()).toEqual([1984, 2021])
  })

  it('filters by kind', () => {
    expect(titles.list({ kind: 'movie' }).total).toBe(4)
    expect(titles.list({ kind: 'series' }).total).toBe(1)
    expect(titles.list({ kind: 'video' }).items.map((t) => t.title)).toEqual(['Trip to Crete'])
  })

  it('sorts by title, newest added, and year', () => {
    expect(titles.list({ kind: 'movie', sort: 'title' }).items.map((t) => t.title)).toEqual(['Dune', 'Dune', 'Interstellar', 'Η Ταινία'])
    expect(titles.list({ sort: 'added' }).items.map((t) => t.title)[0]).toBe('Severance') // added 2025-03-05
    expect(titles.list({ kind: 'movie', sort: 'year' }).items.map((t) => t.year)).toEqual([2021, 2020, 2014, 1984])
  })

  it.each(['title', 'added', 'year'] as const)('pages by cursor without gaps or repeats (%s)', (sort) => {
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = titles.list({ sort, limit: 2, cursor })
      seen.push(...page.items.map((t) => t.key))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toHaveLength(6)
    expect(new Set(seen).size).toBe(6)
  })

  describe('full-text search', () => {
    it('matches prefixes, titles, episode titles and ignores case', () => {
      expect(titles.list({ q: 'sev' }).items.map((t) => t.title)).toEqual(['Severance'])
      expect(titles.list({ q: 'HALF loop' }).items.map((t) => t.title)).toEqual(['Severance'])
      expect(titles.list({ q: 'interstel' }).total).toBe(1)
      expect(titles.list({ q: 'zzz' }).total).toBe(0)
    })
    it('folds Greek case and accents', () => {
      expect(titles.list({ q: 'ταινια' }).items.map((t) => t.title)).toEqual(['Η Ταινία'])
      expect(titles.list({ q: 'ΤΑΙΝΊΑ' }).items.map((t) => t.title)).toEqual(['Η Ταινία'])
    })
    it('matches path words', () => {
      expect(titles.list({ q: 'crete' }).items.map((t) => t.title)).toEqual(['Trip to Crete'])
    })
    it('matches nothing, rather than everything, when only punctuation is typed', () => {
      expect(titles.list({ q: '***' }).total).toBe(0)
    })
    it('does not choke on FTS syntax in the query', () => {
      expect(() => titles.list({ q: 'a" OR NEAR( ' })).not.toThrow()
    })
    it('stays in sync when a file is renamed or its folder is removed', () => {
      const id = handle.raw.prepare("SELECT id FROM media_file WHERE guessed_title = 'Interstellar'").get() as { id: number }
      files.updateMany([{ id: id.id, patch: { guessedTitle: 'Arrival', path: 'D:\\Media\\Arrival.mkv' } }])
      expect(titles.list({ q: 'interstellar' }).total).toBe(0)
      expect(titles.list({ q: 'arrival' }).total).toBe(1)
      library.remove(sourceId)
      expect(titles.list({ q: 'arrival' }).total).toBe(0)
      expect((handle.raw.prepare('SELECT COUNT(*) AS n FROM media_file_fts_docsize').get() as { n: number }).n).toBe(0)
    })
  })

  it('hides unavailable titles when asked, but keeps them (flagged) otherwise', () => {
    handle.raw.prepare("UPDATE library_source SET availability = 'offline'").run()
    const all = titles.list({})
    expect(all.total).toBe(6)
    expect(all.items.every((t) => t.availableCount === 0)).toBe(true)
    expect(titles.list({ hideUnavailable: true }).total).toBe(0)
    handle.raw.prepare("UPDATE library_source SET availability = 'online'").run()
    handle.raw.prepare("UPDATE media_file SET state = 'missing_unconfirmed' WHERE guessed_title = 'Interstellar'").run()
    expect(titles.list({ kind: 'movie', hideUnavailable: true }).items.map((t) => t.title)).not.toContain('Interstellar')
  })
})

describe('TitleRepo.detail', () => {
  it('returns a series with its episodes in order, and null for an unknown key', () => {
    add('episode', 'Dark', { season: 2, episode: 1 })
    add('episode', 'Dark', { season: 1, episode: 2 })
    add('episode', 'Dark', { season: 1, episode: 1 })
    add('episode', 'Dark', { season: null, episode: 5 })
    const key = titles.list({ kind: 'series' }).items[0]!.key
    const detail = titles.detail(key)!
    expect(detail.summary).toMatchObject({ title: 'Dark', kind: 'series', fileCount: 4 })
    expect(detail.files.map((f) => [f.season, f.episode])).toEqual([[null, 5], [1, 1], [1, 2], [2, 1]])
    expect(titles.detail('series:nothing')).toBeNull()
  })

  it('marks files of an offline folder as source_offline', () => {
    add('movie', 'Film', { guessedYear: 2020 })
    handle.raw.prepare("UPDATE library_source SET availability = 'offline'").run()
    const key = titles.list({}).items[0]!.key
    expect(titles.detail(key)!.files[0]!.state).toBe('source_offline')
  })
})

describe('ensureSearchIndex', () => {
  it('rebuilds a missing or stale index, and is a no-op when it is fine', () => {
    add('movie', 'Indexed Film', { guessedYear: 2001 })
    // A row written behind the repository's back (older build, interrupted write) is not searchable...
    handle.raw
      .prepare(
        "INSERT INTO media_file (source_id, path, size, mtime_ms, first_seen_at, last_seen_at, kind, guessed_title, title_key) VALUES (?, ?, 1, 1, 'x', 'x', 'movie', 'Hidden Gem', 'movie:hidden gem:')",
      )
      .run(sourceId, 'D:\\Media\\hidden.mkv')
    expect(titles.list({ q: 'hidden' }).total).toBe(0)
    expect(files.ensureSearchIndex()).toBe(2)
    expect(titles.list({ q: 'hidden' }).total).toBe(1)
    expect(files.ensureSearchIndex()).toBe(0)
  })
})

describe('backfillTitleKeys', () => {
  it('gives rows from before title keys existed their key', () => {
    add('movie', 'Old Film', { guessedYear: 1999, titleKey: null })
    expect(files.backfillTitleKeys()).toBe(1)
    expect(titles.list({}).items[0]!.key).toBe('movie:old film:1999')
    expect(files.backfillTitleKeys()).toBe(0)
  })
})
