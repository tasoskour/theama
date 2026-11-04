import { describe, expect, it } from 'vitest'
import type { Release } from '@theama/contracts'
import { episodesOf, filterReleases, seasonsOf, sortReleases } from './releaseSort'

const rel = (o: Partial<Release> & { id: string }): Release => ({
  title: o.id, size: 1, seeders: 1, leechers: 0, indexer: null, resolution: null, quality: null, codec: null, season: null, episode: null, pack: false, ...o,
})
const none = { resolution: null, minSeeders: 0, season: null, episode: null }

describe('sortReleases', () => {
  const items = [rel({ id: 'a', seeders: 50, resolution: '720p' }), rel({ id: 'b', seeders: 5, resolution: '2160p' }), rel({ id: 'c', seeders: 0, resolution: '2160p' })]
  it('puts quality first and dead releases last', () => {
    expect(sortReleases(items, 'quality').map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })
  it('puts the most seeded first', () => {
    expect(sortReleases(items, 'seeders').map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('series filters', () => {
  const items = [
    rel({ id: 'pack1', season: 1, pack: true }),
    rel({ id: 'e1', season: 1, episode: 1 }),
    rel({ id: 'e2', season: 1, episode: 2 }),
    rel({ id: 's2e1', season: 2, episode: 1 }),
    rel({ id: 'all', pack: true }),
  ]
  it('lists seasons and the episodes of one season', () => {
    expect(seasonsOf(items)).toEqual([1, 2])
    expect(episodesOf(items, 1)).toEqual([1, 2])
    expect(episodesOf(items, null)).toEqual([])
  })
  it('keeps a season with its pack', () => {
    expect(filterReleases(items, { ...none, season: 1 }).map((i) => i.id)).toEqual(['pack1', 'e1', 'e2'])
  })
  it('keeps one episode and the season pack', () => {
    expect(filterReleases(items, { ...none, season: 1, episode: 2 }).map((i) => i.id)).toEqual(['pack1', 'e2'])
  })
  it('applies resolution and seeders', () => {
    expect(filterReleases(items, { ...none, minSeeders: 2 })).toEqual([])
  })
})
