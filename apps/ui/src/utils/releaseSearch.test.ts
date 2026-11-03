import { describe, expect, it } from 'vitest'
import type { LocationQuery } from 'vue-router'
import { CollectionMember, type TitleSummary } from '@theama/contracts'
import { collectionReleaseTarget, releaseSearchFromRoute, releaseSearchRoute } from './releaseSearch'

describe('release search deep links', () => {
  it('round-trips movies, seasons, episodes and specials through route parameters', () => {
    for (const target of [
      { kind: 'movie' as const, title: 'Mad Max 2', year: 1981 },
      { kind: 'movie' as const, title: 'Mad Max 2', year: 1981, collectionName: 'Mad Max Collection' },
      { kind: 'series' as const, title: 'Severance', season: 2 },
      { kind: 'series' as const, title: 'Severance', season: 1, episode: 2 },
      { kind: 'series' as const, title: 'Severance', season: 0, episode: 0 },
    ]) {
      expect(releaseSearchFromRoute(releaseSearchRoute(target).query!)).toEqual(target)
    }
  })

  it('accepts API boundary years and numbers, independent of the discovery year list', () => {
    for (const year of ['1870', '2200']) expect(releaseSearchFromRoute({ kind: 'movie', title: 'Film', year })?.year).toBe(Number(year))
    expect(releaseSearchFromRoute({ kind: 'series', title: 'Show', season: '99', episode: '999' })).toEqual({ kind: 'series', title: 'Show', season: 99, episode: 999 })
  })

  it.each(['', ' ', '-1', '1.5', '2abc', '1e1', '100', null, ['1', '2']])('ignores an invalid season (%j) and its episode', (season) => {
    expect(releaseSearchFromRoute({ kind: 'series', title: 'Show', season, episode: '2' })).toEqual({ kind: 'series', title: 'Show', season: undefined, episode: undefined })
  })

  it.each(['', ' ', '-1', '1.5', '2abc', '1000', null, ['1', '2']])('ignores an invalid episode (%j) while keeping the season', (episode) => {
    expect(releaseSearchFromRoute({ kind: 'series', title: 'Show', season: '1', episode })).toEqual({ kind: 'series', title: 'Show', season: 1, episode: undefined })
  })

  it('ignores irrelevant numbers, orphaned episodes and invalid years', () => {
    expect(releaseSearchFromRoute({ kind: 'series', title: 'Show', episode: '2', year: '2020' })).toEqual({ kind: 'series', title: 'Show', season: undefined, episode: undefined })
    expect(releaseSearchFromRoute({ kind: 'movie', title: 'Film', year: '1869', season: '1', episode: '2' })).toEqual({ kind: 'movie', title: 'Film', year: undefined })
    expect(releaseSearchFromRoute({ kind: 'movie', title: 'Film', year: '2201' })?.year).toBeUndefined()
  })

  it('requires a supported kind and a nonempty title within the API limit', () => {
    const queries: LocationQuery[] = [{}, { kind: 'video', title: 'Trip' }, { kind: ['movie'], title: 'Film' }, { kind: 'movie', title: ' ' }, { kind: 'movie', title: ['Film'] }, { kind: 'movie', title: 'x'.repeat(201) }]
    for (const query of queries) {
      expect(releaseSearchFromRoute(query)).toBeNull()
    }
    expect(releaseSearchFromRoute({ kind: 'movie', title: ' Film ' })?.title).toBe('Film')
  })
})

describe('missing collection members', () => {
  const member = CollectionMember.parse({ position: 1, key: null, titleKey: null, title: 'Mad Max 2', year: 1981, releaseDate: null, overview: null, posterUrl: null, summary: null })

  it('searches official movies by title and known year', () => {
    expect(collectionReleaseTarget(member, 'official')).toEqual({ kind: 'movie', title: 'Mad Max 2', year: 1981 })
    expect(collectionReleaseTarget(member, 'official', 'Mad Max Collection')).toEqual({ kind: 'movie', title: 'Mad Max 2', year: 1981, collectionName: 'Mad Max Collection' })
    expect(collectionReleaseTarget({ ...member, year: null }, 'official')).toEqual({ kind: 'movie', title: 'Mad Max 2' })
  })

  it('recovers movies and series from stored user collection keys', () => {
    expect(collectionReleaseTarget({ ...member, titleKey: 'movie:mad max 2:1981' }, 'user')).toEqual({ kind: 'movie', title: 'Mad Max 2', year: 1981 })
    expect(collectionReleaseTarget({ ...member, title: 'Severance', titleKey: 'series:severance' }, 'user')).toEqual({ kind: 'series', title: 'Severance' })
    for (const titleKey of [null, 'video:C:/Trip.mp4', 'extra:foo', 'unknown:foo']) expect(collectionReleaseTarget({ ...member, titleKey }, 'user')).toBeNull()
  })

  it('does not treat local members as missing even when their files are offline', () => {
    const summary = { kind: 'movie', availableCount: 0 } as TitleSummary
    expect(collectionReleaseTarget({ ...member, summary }, 'official')).toBeNull()
  })
})
