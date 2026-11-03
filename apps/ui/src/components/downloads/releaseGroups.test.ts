import { describe, expect, it } from 'vitest'
import type { Release } from '@theama/contracts'
import { groupReleases } from './releaseGroups'

const item = (title: string, overrides: Partial<Release> = {}): Release => ({
  id: title, title, size: 1, seeders: 1, leechers: 0, indexer: null,
  resolution: null, quality: null, codec: null, season: null, episode: null, pack: false,
  ...overrides,
})

describe('release groups', () => {
  it('puts complete series and season packs before per-episode results and keeps other releases separate', () => {
    const results = groupReleases([
      item('episode 10', { season: 1, episode: 10 }),
      item('unknown'),
      item('season 2', { season: 2, pack: true }),
      item('episode 2 high', { season: 1, episode: 2, seeders: 50 }),
      item('complete', { pack: true }),
      item('season 1', { season: 1, pack: true }),
      item('episode 2 low', { season: 1, episode: 2, seeders: 5 }),
    ], 'series')
    expect(results.map((group) => group.key)).toEqual(['complete', 'season-1', 'season-2', 'episode-1-2', 'episode-1-10', 'other'])
    expect(results[3]?.items.map((release) => release.title)).toEqual(['episode 2 high', 'episode 2 low'])
  })

  it('shows movie collection packs before individual films', () => {
    const results = groupReleases([item('film'), item('collection', { collectionPack: true })], 'movie')
    expect(results.map((group) => group.key)).toEqual(['collection', 'movie'])
  })
})
