import { describe, expect, it } from 'vitest'
import { decide, scoreCandidate, titleSimilarity } from './matcher'
import type { ProviderCandidate } from './provider'

const cand = (over: Partial<ProviderCandidate> & { title: string }): ProviderCandidate => ({
  externalId: over.externalId ?? over.title,
  kind: 'movie',
  originalTitle: null,
  year: null,
  overview: null,
  posterPath: null,
  popularity: 10,
  rating: null,
  ...over,
})

describe('titleSimilarity', () => {
  it('ignores case, accents, punctuation and word order', () => {
    expect(titleSimilarity('X-Men 97', "X-Men '97")).toBe(1)
    expect(titleSimilarity('Amelie', 'Amélie')).toBe(1)
    expect(titleSimilarity('ΤΑΙΝΙΑ', 'Ταινία')).toBe(1)
    expect(titleSimilarity('Machina Vox', 'Vox Machina')).toBeGreaterThan(0.95)
  })
  it('tolerates a typo but not a different title', () => {
    expect(titleSimilarity('Interstelar', 'Interstellar')).toBeGreaterThan(0.85)
    expect(titleSimilarity('Interstellar', 'Gladiator')).toBeLessThan(0.3)
  })
  it('rates a title contained in a longer one as plausible but never perfect', () => {
    const s = titleSimilarity('Dune', 'Dune: Part Two')
    expect(s).toBeGreaterThan(0.5)
    expect(s).toBeLessThan(0.85)
  })
  it('is zero for nothing comparable', () => {
    expect(titleSimilarity('', 'Dune')).toBe(0)
    expect(titleSimilarity('!!!', 'Dune')).toBe(0)
  })
})

describe('scoreCandidate', () => {
  it('uses the original title when it fits better than the translated one', () => {
    const c = cand({ title: 'Parasite', originalTitle: '기생충' })
    expect(scoreCandidate({ kind: 'movie', title: '기생충', year: 2019 }, { ...c, year: 2019 }).signals.title).toBe(1)
  })
  it('does not punish a candidate when the file name has no year', () => {
    const noYear = scoreCandidate({ kind: 'series', title: 'Severance', year: null }, cand({ title: 'Severance', year: 2022 }))
    expect(noYear.signals.year).toBeNull()
    expect(noYear.score).toBeGreaterThan(0.85)
  })
  it('scores year agreement: exact, off by one, different', () => {
    const at = (y: number) => scoreCandidate({ kind: 'movie', title: 'Dune', year: 2021 }, cand({ title: 'Dune', year: y })).signals.year
    expect([at(2021), at(2022), at(1984)]).toEqual([1, 0.5, 0])
  })
})

describe('decide', () => {
  it('accepts a clear winner', () => {
    const d = decide({ kind: 'movie', title: 'Dune', year: 2021 }, [
      cand({ title: 'Dune', year: 1984, externalId: '841' }),
      cand({ title: 'Dune', year: 2021, externalId: '438631' }),
      cand({ title: 'Dune: Part Two', year: 2024, externalId: '693134' }),
    ])
    expect(d.state).toBe('matched')
    if (d.state === 'matched') expect(d.best.candidate.externalId).toBe('438631')
  })

  it('asks instead of guessing when two titles are equally good (no year)', () => {
    const d = decide({ kind: 'series', title: 'Doctor Who', year: null }, [
      cand({ title: 'Doctor Who', year: 1963, externalId: '1000', kind: 'series' }),
      cand({ title: 'Doctor Who', year: 2005, externalId: '57243', kind: 'series', popularity: 120 }),
    ])
    expect(d.state).toBe('ambiguous')
  })

  it('does not auto-match when the year is more than two years off, even with a perfect title', () => {
    const d = decide({ kind: 'movie', title: 'Obscure Gem', year: 2010 }, [cand({ title: 'Obscure Gem', year: 2001 })])
    expect(d.state).not.toBe('matched')
  })

  it('treats weak resemblance as unmatched and no results as unmatched', () => {
    expect(decide({ kind: 'movie', title: 'Zxqv Wplm', year: null }, [cand({ title: 'Gladiator', year: 2000 })]).state).toBe('unmatched')
    expect(decide({ kind: 'movie', title: 'Anything', year: null }, []).state).toBe('unmatched')
  })

  it('offers a plausible but imperfect candidate to the user', () => {
    const d = decide({ kind: 'movie', title: 'Dune', year: null }, [cand({ title: 'Dune: Part Two', year: 2024 })])
    expect(d.state).toBe('ambiguous')
  })
})
