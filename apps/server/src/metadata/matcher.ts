import type { MatchKind } from '@theama/contracts'
import { normaliseTitle } from '../scan/filename'
import type { ProviderCandidate } from './provider'

/** What we know about a group of files before asking a provider. */
export interface MatchInput {
  kind: MatchKind
  title: string
  year: number | null
}

export interface Signals {
  /** 0–1 similarity of the best of title / original title. */
  title: number
  /** 0–1, or null when the file name has no year or the candidate has no date. */
  year: number | null
  /** 0–1 log-scaled popularity, used only to break near ties. */
  popularity: number
}

export interface ScoredCandidate {
  candidate: ProviderCandidate
  score: number
  signals: Signals
}

/**
 * Weights from docs/07-metadata-matching.md. The runtime, kind and sibling signals are not available at
 * search time (search results carry no runtime; kind is a hard filter of the search), so scoring uses
 * the remaining signals and divides by the weight actually available. A missing year therefore does not
 * punish a candidate, it just means the title has to carry the decision on its own.
 */
export const WEIGHTS = { title: 0.5, year: 0.2, popularity: 0.05 } as const

/** At or above this (and clearly ahead of the runner-up) a match is accepted without asking. */
export const AUTO_THRESHOLD = 0.85
/** Required lead over the second-best candidate for an automatic match. */
export const AUTO_MARGIN = 0.1
/** Below this nothing is plausible enough to offer. */
export const OFFER_THRESHOLD = 0.55

export type Decision =
  | { state: 'matched'; best: ScoredCandidate; ranked: ScoredCandidate[] }
  | { state: 'ambiguous'; best: ScoredCandidate; ranked: ScoredCandidate[] }
  | { state: 'unmatched'; ranked: ScoredCandidate[] }

function tokens(s: string): string[] {
  return normaliseTitle(s).split(' ').filter(Boolean)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]!
}

/** How alike two titles are, 0–1: accents, case, punctuation and word order do not matter. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.length === 0 || tb.length === 0) return 0
  const na = ta.join(' ')
  const nb = tb.join(' ')
  if (na === nb) return 1
  const edit = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length)
  const sa = new Set(ta)
  const sb = new Set(tb)
  const shared = [...sa].filter((t) => sb.has(t)).length
  if (shared === sa.size && shared === sb.size) return 0.98 // the same words in another order
  const jaccard = shared / (sa.size + sb.size - shared)
  // The wanted title is wholly inside a longer one ("Dune" in "Dune: Part Two"): plausible, never perfect.
  const contained = shared === sa.size || shared === sb.size ? 0.8 * (Math.min(sa.size, sb.size) / Math.max(sa.size, sb.size)) ** 0.25 : 0
  return Math.max(edit, jaccard, contained)
}

function yearSignal(wanted: number | null, got: number | null): number | null {
  if (wanted === null || got === null) return null
  const d = Math.abs(wanted - got)
  return d === 0 ? 1 : d === 1 ? 0.5 : 0
}

const popularitySignal = (p: number): number => Math.min(1, Math.log10(1 + Math.max(0, p)) / Math.log10(201))

export function scoreCandidate(input: MatchInput, c: ProviderCandidate): ScoredCandidate {
  const title = Math.max(titleSimilarity(input.title, c.title), c.originalTitle ? titleSimilarity(input.title, c.originalTitle) : 0)
  const signals: Signals = { title, year: yearSignal(input.year, c.year), popularity: popularitySignal(c.popularity) }
  let sum = WEIGHTS.title * signals.title + WEIGHTS.popularity * signals.popularity
  let weight = WEIGHTS.title + WEIGHTS.popularity
  if (signals.year !== null) {
    sum += WEIGHTS.year * signals.year
    weight += WEIGHTS.year
  }
  return { candidate: c, score: Math.round((sum / weight) * 1000) / 1000, signals }
}

/** Ranks candidates best first (ties broken by popularity, then id so the order is stable). */
export function rank(input: MatchInput, candidates: readonly ProviderCandidate[]): ScoredCandidate[] {
  return candidates
    .map((c) => scoreCandidate(input, c))
    .sort((a, b) => b.score - a.score || b.candidate.popularity - a.candidate.popularity || a.candidate.externalId.localeCompare(b.candidate.externalId))
}

/**
 * Accepts a match only when it is both strong and clearly ahead, and the year (when both sides have one)
 * is within two years. Anything plausible but not certain is offered to the user instead; a wrong match
 * is never attached silently.
 */
export function decide(input: MatchInput, candidates: readonly ProviderCandidate[]): Decision {
  const ranked = rank(input, candidates)
  const best = ranked[0]
  if (!best || best.score < OFFER_THRESHOLD) return { state: 'unmatched', ranked }
  const second = ranked[1]
  const yearOk = input.year === null || best.candidate.year === null || Math.abs(input.year - best.candidate.year) <= 2
  const ahead = !second || best.score - second.score >= AUTO_MARGIN
  if (best.score >= AUTO_THRESHOLD && ahead && yearOk) return { state: 'matched', best, ranked }
  return { state: 'ambiguous', best, ranked }
}
