import type { MatchCandidate } from '@theama/contracts'

/** Search matches and suggestions share a preview; only suggestions have a rating. */
export type SuggestionItem = MatchCandidate & { rating?: number | null }
