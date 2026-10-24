import { describe, expect, it } from 'vitest'
import type { ReleaseQuery } from '@theama/contracts'
import { matchesQuery, parseRelease, rankReleases, type RawRelease } from './release'
import { searchText } from './service'

describe('parseRelease', () => {
  it('reads quality, source and codec', () => {
    expect(parseRelease('Dune.2021.2160p.UHD.BluRay.x265-GRP')).toMatchObject({ resolution: '2160p', quality: 'BluRay', codec: 'HEVC', season: null, pack: false })
    expect(parseRelease('Dune 2021 1080p WEB-DL H.264')).toMatchObject({ resolution: '1080p', quality: 'WEB-DL', codec: 'H.264' })
    expect(parseRelease('Dune.2021.REMUX.1080p')).toMatchObject({ quality: 'Remux' })
    expect(parseRelease('Dune 2021')).toMatchObject({ resolution: null, quality: null, codec: null })
  })

  it('tells an episode from a season pack', () => {
    expect(parseRelease('Severance.S01E02.1080p.WEB')).toMatchObject({ season: 1, episode: 2, pack: false })
    expect(parseRelease('Severance 1x03 720p')).toMatchObject({ season: 1, episode: 3 })
    expect(parseRelease('Severance.S02.1080p.WEB-DL')).toMatchObject({ season: 2, episode: null, pack: true })
    expect(parseRelease('Severance Season 1 Complete')).toMatchObject({ season: 1, pack: true })
    expect(parseRelease('Severance Complete Series 1080p')).toMatchObject({ season: null, pack: true })
  })
})

const movie = (title: string, year?: number): ReleaseQuery => ({ kind: 'movie', title, ...(year === undefined ? {} : { year }) })
const show = (title: string, season?: number, episode?: number): ReleaseQuery => ({
  kind: 'series',
  title,
  ...(season === undefined ? {} : { season }),
  ...(episode === undefined ? {} : { episode }),
})
const fits = (name: string, q: ReleaseQuery) => matchesQuery(name, parseRelease(name), q)

describe('matchesQuery', () => {
  it('keeps only releases that start with the title, ignoring case and punctuation', () => {
    expect(fits('Dune.2021.1080p.BluRay', movie('Dune', 2021))).toBe(true)
    expect(fits('The.Matrix.1999.720p', movie('The Matrix', 1999))).toBe(true)
    expect(fits('Dune Part Two 2024 1080p', movie('Dune', 2021))).toBe(false)
    expect(fits('Making of Dune 2021', movie('Dune'))).toBe(false)
    expect(fits('Amélie.2001.1080p', movie('Amelie', 2001))).toBe(true)
  })

  it('rejects a movie from another year or one that is really an episode', () => {
    expect(fits('Dune.1984.1080p', movie('Dune', 2021))).toBe(false)
    expect(fits('Dune.S01E01.720p', movie('Dune'))).toBe(false)
    expect(fits('Dune 1080p', movie('Dune', 2021))).toBe(true) // no year in the name: can't contradict
  })

  it('matches episodes and the season packs that contain them', () => {
    const q = show('Severance', 1, 2)
    expect(fits('Severance.S01E02.1080p', q)).toBe(true)
    expect(fits('Severance.S01E03.1080p', q)).toBe(false)
    expect(fits('Severance.S02E02.1080p', q)).toBe(false)
    expect(fits('Severance.S01.1080p.WEB-DL', q)).toBe(true)
    expect(fits('Severance Complete Series', q)).toBe(true)
    expect(fits('Severance 1080p', q)).toBe(false)
  })

  it('a season request wants packs, not single episodes', () => {
    const q = show('Severance', 1)
    expect(fits('Severance.S01.1080p', q)).toBe(true)
    expect(fits('Severance.S01E04.1080p', q)).toBe(false)
  })
})

describe('rankReleases', () => {
  const r = (over: Partial<RawRelease>): RawRelease => ({
    title: 't', size: 1, seeders: 1, leechers: 0, indexer: null, resolution: null, quality: null, codec: null, season: null, episode: null, pack: false, ...over,
  })
  it('puts seeded releases first, then better resolution, then more seeders', () => {
    const ranked = rankReleases([
      r({ title: 'dead', seeders: 0, resolution: '2160p' }),
      r({ title: '720-many', seeders: 500, resolution: '720p' }),
      r({ title: '1080-few', seeders: 3, resolution: '1080p' }),
      r({ title: '1080-many', seeders: 90, resolution: '1080p' }),
    ])
    expect(ranked.map((x) => x.title)).toEqual(['1080-many', '1080-few', '720-many', 'dead'])
  })
})

describe('searchText', () => {
  it('builds what is typed into the indexer', () => {
    expect(searchText(movie('Dune', 2021))).toBe('Dune 2021')
    expect(searchText(movie('Dune'))).toBe('Dune')
    expect(searchText(show('Severance'))).toBe('Severance')
    expect(searchText(show('Severance', 1))).toBe('Severance S01')
    expect(searchText(show('Severance', 1, 2))).toBe('Severance S01E02')
  })
})
