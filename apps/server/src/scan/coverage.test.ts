import { describe, expect, it } from 'vitest'
import type { StoredEpisode } from '../metadata/store'
import { buildCoverage, type CoverageFile } from './coverage'

const ep = (season: number, episode: number, airDate: string | null): StoredEpisode => ({
  season, episode, name: `S${season}E${episode}`, overview: null, airDate, runtimeMinutes: null, stillUrl: null,
})
const file = (id: number, season: number | null, episode: number | null, episodeEnd: number | null = null): CoverageFile => ({ id, season, episode, episodeEnd })
const TODAY = '2025-06-01'

describe('buildCoverage', () => {
  const provider = [ep(1, 1, '2025-01-01'), ep(1, 2, '2025-01-08'), ep(1, 3, '2025-01-15'), ep(1, 4, '2025-07-01'), ep(1, 5, null), ep(0, 1, '2020-01-01')]

  it('classifies every provider episode: local, missing (aired), upcoming (future), undated', () => {
    const { episodes, coverage } = buildCoverage(provider, [file(1, 1, 1), file(2, 1, 3)], TODAY)
    expect(episodes.map((e) => [e.season, e.episode, e.status])).toEqual([
      [1, 1, 'local'], [1, 2, 'missing'], [1, 3, 'local'], [1, 4, 'upcoming'], [1, 5, 'undated'], [0, 1, 'missing'],
    ])
    expect(coverage.seasons).toEqual([
      { season: 0, expected: 1, local: 0, missing: 1, upcoming: 0, undated: 0, notInProvider: 0, duplicates: 0 },
      { season: 1, expected: 5, local: 2, missing: 1, upcoming: 1, undated: 1, notInProvider: 0, duplicates: 0 },
    ])
  })

  it('an episode airing today counts as aired', () => {
    const { episodes } = buildCoverage([ep(1, 1, TODAY)], [], TODAY)
    expect(episodes[0]?.status).toBe('missing')
  })

  it('a multi-episode file covers every episode in its range', () => {
    const { episodes } = buildCoverage(provider, [file(1, 1, 1, 2)], TODAY)
    expect(episodes.slice(0, 2).map((e) => [e.status, e.fileIds])).toEqual([['local', [1]], ['local', [1]]])
    expect(episodes[2]?.status).toBe('missing')
  })

  it('flags duplicates without counting an episode twice', () => {
    const { episodes, coverage } = buildCoverage(provider, [file(1, 1, 1), file(2, 1, 1)], TODAY)
    expect(episodes[0]).toMatchObject({ status: 'local', fileIds: [1, 2] })
    expect(coverage.seasons.find((s) => s.season === 1)).toMatchObject({ local: 1, duplicates: 1 })
  })

  it('keeps files the provider does not list, or that have no numbers, visible as unmatched', () => {
    const { coverage } = buildCoverage(provider, [file(1, 1, 1), file(2, 1, 99), file(3, null, 4), file(4, 2, 1), file(5, 1, null)], TODAY)
    expect(coverage.unmatchedFileIds.sort()).toEqual([2, 3, 4, 5])
    expect(coverage.seasons.find((s) => s.season === 1)?.notInProvider).toBe(1)
    // A season only the files know about still gets a row, with nothing expected.
    expect(coverage.seasons.find((s) => s.season === 2)).toMatchObject({ expected: 0, notInProvider: 1 })
  })

  it('a range that runs past the provider list matches what exists and flags the file', () => {
    const { episodes, coverage } = buildCoverage([ep(1, 1, '2025-01-01'), ep(1, 2, '2025-01-01')], [file(1, 1, 2, 3)], TODAY)
    expect(episodes[1]?.status).toBe('local')
    expect(coverage.unmatchedFileIds).toEqual([1])
  })

  it('does not loop on an absurd range', () => {
    const { coverage } = buildCoverage([ep(1, 1, '2025-01-01')], [file(1, 1, 1, 9_999_999)], TODAY)
    expect(coverage.unmatchedFileIds).toEqual([1])
  })

  it('handles a series with no provider data at all', () => {
    const { episodes, coverage } = buildCoverage([], [file(1, 1, 1)], TODAY)
    expect(episodes).toEqual([])
    expect(coverage.unmatchedFileIds).toEqual([1])
  })
})
