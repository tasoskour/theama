import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DbHandle } from '../db/client'
import { LibrarySourceRepo } from '../library/sources'
import { titleKeyFor } from '../scan/filename'
import { MediaFileRepo } from '../scan/store'
import { METADATA_VERSION, MetadataRepo } from './store'
import type { ProviderTitle } from './provider'

let handle: DbHandle
let repo: MetadataRepo

const title = (over: Partial<ProviderTitle> = {}): ProviderTitle => ({
  externalId: '1', kind: 'movie', title: 'Film', originalTitle: null, year: 2000, tagline: null, overview: null, runtimeMinutes: null,
  genres: [], rating: null, posterPath: null, backdropPath: null, cast: [], imdbId: null, status: null, seasons: [], collection: null, ...over,
})

function addFile(name: string, kind: 'movie' | 'episode' = 'movie'): string {
  const files = new MediaFileRepo(handle.db, handle.raw)
  const sources = new LibrarySourceRepo(handle.db)
  const sourceId = sources.list()[0]?.id ?? sources.create({ path: 'D:/M', libraryType: 'auto', recursive: true, volumeId: '1' }).id
  const key = titleKeyFor(kind, name, 2000, `D:/M/${name}.mkv`)
  files.insertMany([
    { sourceId, path: `D:/M/${name}.mkv`, size: 1, mtimeMs: 1, state: 'available', firstSeenAt: 'x', lastSeenAt: 'x', kind, guessedTitle: name, guessedYear: 2000, season: null, episode: null, episodeEnd: null, episodeTitle: null, titleKey: key },
  ])
  return key
}

function store(key: string, over: Partial<ProviderTitle> = {}, language = 'en'): void {
  handle.raw.transaction(() => {
    repo.saveMatch({ key, kind: over.kind ?? 'movie', state: 'matched', provider: 'tmdb', externalId: '1', decidedBy: 'auto' }, '2025-01-01T00:00:00.000Z')
    repo.saveMetadata({ key, provider: 'tmdb', language, title: title(over), posterFile: null, backdropFile: null }, [], new Map(), '2025-01-01T00:00:00.000Z')
  })()
}

beforeEach(() => {
  handle = openDatabase(':memory:')
  repo = new MetadataRepo(handle.raw)
})
afterEach(() => handle.close())

describe('MetadataRepo.stale', () => {
  const now = new Date('2025-01-02T00:00:00.000Z')

  it('is empty for fresh, current-language data', () => {
    store(addFile('Film'))
    expect(repo.stale('en', 10, now)).toEqual([])
  })

  it('picks up data in another language and data written by an older build', () => {
    const key = addFile('Film')
    store(key)
    expect(repo.stale('el', 10, now).map((s) => s.key)).toEqual([key])
    handle.raw.prepare('UPDATE title_metadata SET version = ?').run(METADATA_VERSION - 1)
    expect(repo.stale('en', 10, now).map((s) => s.key)).toEqual([key])
  })

  it('refreshes a series that is still airing after a week, and never a finished one', () => {
    const airing = addFile('Airing', 'episode')
    const ended = addFile('Ended', 'episode')
    store(airing, { kind: 'series', status: 'Returning Series' })
    store(ended, { kind: 'series', status: 'Ended' })
    const later = new Date('2025-01-20T00:00:00.000Z')
    expect(repo.stale('en', 10, now)).toEqual([])
    expect(repo.stale('en', 10, later).map((s) => s.key)).toEqual([airing])
  })

  it('retries a movie whose collection could not be read, until the collection exists', () => {
    const key = addFile('Part One')
    store(key, { collection: { externalId: '77', name: 'Saga' } })
    expect(repo.stale('en', 10, now).map((s) => s.key)).toEqual([key])
    handle.raw
      .prepare("INSERT INTO collection (kind, provider, external_id, name, created_at, updated_at) VALUES ('official', 'tmdb', '77', 'Saga', 'x', 'x')")
      .run()
    expect(repo.stale('en', 10, now)).toEqual([])
  })

  it('ignores titles that no longer have files', () => {
    store('movie:ghost:2000')
    expect(repo.stale('el', 10, now)).toEqual([])
  })
})
