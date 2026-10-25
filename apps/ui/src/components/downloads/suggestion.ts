import type { MatchCandidate } from '@theama/contracts'

/** Search matches and suggestions share a preview and both carry the provider's rating; saved favorites may lack it. */
export type SuggestionItem = MatchCandidate & { rating?: number | null }
