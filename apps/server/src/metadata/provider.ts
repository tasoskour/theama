import type { MatchKind } from '@theama/contracts'

/** Why a provider call failed, in terms the rest of the app can act on. */
export type ProviderErrorKind = 'auth' | 'unavailable' | 'not_found'

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export interface SearchQuery {
  kind: MatchKind
  title: string
  year?: number | undefined
  /** BCP-47 tag, e.g. `el-GR`. */
  language: string
}

/** A search hit. Image paths are provider-relative; the artwork cache turns them into local files. */
export interface ProviderCandidate {
  externalId: string
  kind: MatchKind
  title: string
  originalTitle: string | null
  year: number | null
  overview: string | null
  posterPath: string | null
  popularity: number
}

export interface ProviderTitle {
  externalId: string
  kind: MatchKind
  title: string
  originalTitle: string | null
  year: number | null
  tagline: string | null
  overview: string | null
  runtimeMinutes: number | null
  genres: string[]
  rating: { value: number; votes: number } | null
  posterPath: string | null
  backdropPath: string | null
  cast: { name: string; character: string | null }[]
  imdbId: string | null
  status: string | null
  /** Series only: season numbers that exist, including 0 for specials. */
  seasons: number[]
}

export interface ProviderEpisode {
  season: number
  episode: number
  name: string | null
  overview: string | null
  airDate: string | null
  runtimeMinutes: number | null
  stillPath: string | null
}

export type ImageSize = 'thumb' | 'poster' | 'backdrop' | 'still'

export interface MetadataProvider {
  readonly id: string
  search(query: SearchQuery): Promise<ProviderCandidate[]>
  fetchTitle(kind: MatchKind, externalId: string, language: string): Promise<ProviderTitle>
  fetchSeason(seriesId: string, season: number, language: string): Promise<ProviderEpisode[]>
  /** Where to download an image from; the result is only ever fetched by the artwork cache. */
  imageUrl(path: string, size: ImageSize): string
  /** Throws a ProviderError('auth') when the credentials are rejected. */
  validate(): Promise<void>
  /** Clears any "paused after failures" state, e.g. after new credentials. */
  reset(): void
  /** Stops in-flight calls and refuses new ones (service shutdown). */
  close(): void
}
