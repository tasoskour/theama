import { z } from 'zod'
import { IsoDate } from './common'

/** Only series and movies are identified; personal videos are never matched. */
export const MatchKind = z.enum(['movie', 'series'])
export type MatchKind = z.infer<typeof MatchKind>

export const MetadataLanguage = z.enum(['en', 'el'])
export type MetadataLanguage = z.infer<typeof MetadataLanguage>

export const MatchState = z.enum(['matched', 'ambiguous', 'unmatched'])
export type MatchState = z.infer<typeof MatchState>

/** A possible identity for a title, as returned by a provider search. */
export const MatchCandidate = z.object({
  provider: z.string(),
  externalId: z.string(),
  kind: MatchKind,
  title: z.string(),
  originalTitle: z.string().nullable(),
  year: z.number().int().nullable(),
  overview: z.string().nullable(),
  /** Remote artwork is never hot-linked: candidates carry a cached local poster only once chosen. */
  posterUrl: z.string().nullable(),
  /** 0–1 confidence from the matcher; null for manual search results. */
  score: z.number().nullable(),
})
export type MatchCandidate = z.infer<typeof MatchCandidate>

export const TitleMatch = z.object({
  state: MatchState,
  decidedBy: z.enum(['auto', 'user']),
  /** A locked match is never replaced by a rescan or a refresh. */
  locked: z.boolean(),
  score: z.number().nullable(),
  provider: z.string().nullable(),
  externalId: z.string().nullable(),
  /** Only for `ambiguous`: the best guesses to choose from. */
  candidates: z.array(MatchCandidate),
})
export type TitleMatch = z.infer<typeof TitleMatch>

export const CastMember = z.object({ name: z.string(), character: z.string().nullable() })
export type CastMember = z.infer<typeof CastMember>

/** A rating always says who gave it; a TMDB rating is never shown as an IMDb rating. */
export const Rating = z.object({ source: z.string(), value: z.number(), votes: z.number().int() })
export type Rating = z.infer<typeof Rating>

export const TitleMetadata = z.object({
  provider: z.string(),
  externalId: z.string(),
  title: z.string(),
  originalTitle: z.string().nullable(),
  year: z.number().int().nullable(),
  tagline: z.string().nullable(),
  overview: z.string().nullable(),
  runtimeMinutes: z.number().int().nullable(),
  genres: z.array(z.string()),
  rating: Rating.nullable(),
  posterUrl: z.string().nullable(),
  backdropUrl: z.string().nullable(),
  cast: z.array(CastMember),
  imdbId: z.string().nullable(),
  status: z.string().nullable(),
  /** Provider id of the official collection this movie belongs to, if any. */
  collectionId: z.string().nullable(),
  language: z.string(),
  fetchedAt: IsoDate,
})
export type TitleMetadata = z.infer<typeof TitleMetadata>

/**
 * What a series episode is to the library right now.
 * local: at least one file. missing: aired, no file. upcoming: not aired yet.
 * undated: the provider has no air date, so Theama cannot say whether it is missing.
 */
export const EpisodeStatus = z.enum(['local', 'missing', 'upcoming', 'undated'])
export type EpisodeStatus = z.infer<typeof EpisodeStatus>

export const EpisodeInfo = z.object({
  season: z.number().int(),
  episode: z.number().int(),
  name: z.string().nullable(),
  overview: z.string().nullable(),
  airDate: z.string().nullable(),
  runtimeMinutes: z.number().int().nullable(),
  stillUrl: z.string().nullable(),
  status: EpisodeStatus,
  /** Files that play this episode; more than one means duplicates (or several versions). */
  fileIds: z.array(z.number().int()),
})
export type EpisodeInfo = z.infer<typeof EpisodeInfo>

export const MetadataState = z.enum(['no_key', 'idle', 'working', 'unavailable', 'invalid_key'])
export type MetadataState = z.infer<typeof MetadataState>

export const MetadataStatus = z.object({
  provider: z.literal('tmdb'),
  configured: z.boolean(),
  state: MetadataState,
  /** Titles still waiting to be looked up. */
  pending: z.number().int(),
  matched: z.number().int(),
  ambiguous: z.number().int(),
  unmatched: z.number().int(),
  /** The title being looked up right now, for the progress line. */
  current: z.string().nullable(),
  /** A short, human-readable reason when `state` is `unavailable` or `invalid_key`. */
  message: z.string().nullable(),
})
export type MetadataStatus = z.infer<typeof MetadataStatus>

export const SetCredentialsRequest = z.object({
  /** `null` removes the key. A v3 API key or a v4 read-access token are both accepted. */
  tmdbApiKey: z.string().trim().min(8).max(2000).nullable(),
})
export type SetCredentialsRequest = z.infer<typeof SetCredentialsRequest>

export const MetadataSearchQuery = z.object({
  kind: MatchKind,
  q: z.string().trim().min(1).max(200),
  year: z.coerce.number().int().min(1870).max(2200).optional(),
})
export type MetadataSearchQuery = z.input<typeof MetadataSearchQuery>

export const MetadataSearchResult = z.object({ items: z.array(MatchCandidate) })
export type MetadataSearchResult = z.infer<typeof MetadataSearchResult>

export const IdentifyRequest = z.object({
  key: z.string().min(1).max(1000),
  externalId: z.string().min(1).max(40),
  kind: MatchKind,
})
export type IdentifyRequest = z.infer<typeof IdentifyRequest>

export const TitleKeyRequest = z.object({ key: z.string().min(1).max(1000) })
export type TitleKeyRequest = z.infer<typeof TitleKeyRequest>
