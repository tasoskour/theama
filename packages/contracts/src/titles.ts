import { z } from 'zod'
import { IsoDate } from './common'
import { MediaFile } from './media'
import { CollectionRef } from './collection-ref'
import { PlaybackInfo } from './playback-info'
import { EpisodeInfo, MatchState, TitleMatch, TitleMetadata } from './metadata'

/** What a card in the library represents. A series is one card for all of its episodes. */
export const TitleKind = z.enum(['movie', 'series', 'video'])
export type TitleKind = z.infer<typeof TitleKind>

export const TitleSort = z.enum(['title', 'added', 'year'])
export type TitleSort = z.infer<typeof TitleSort>

export const TitleSummary = z.object({
  /** Stable within the library: groups files by guessed identity until metadata matching exists. */
  key: z.string(),
  kind: TitleKind,
  title: z.string(),
  year: z.number().int().nullable(),
  fileCount: z.number().int(),
  /** Distinct numbered episodes (series only). */
  episodeCount: z.number().int(),
  seasonCount: z.number().int(),
  /** Files that can be used right now (their folder is online and they are present). */
  availableCount: z.number().int(),
  /** When the newest file of this title was first seen. */
  addedAt: IsoDate,
  size: z.number(),
  /** Cached artwork served by the backend; null until the title is identified. */
  posterUrl: z.string().nullable(),
  /** Rating from the metadata provider (0–10), if known. Shown labelled by provider, never as IMDb. */
  rating: z.number().nullable(),
  /** null for personal videos, which are never identified. */
  matchState: MatchState.nullable(),
  /** Series with provider data: aired episodes without a file (specials not counted). Null when unknown. */
  missingEpisodes: z.number().int().nullable(),
  /** None, some or all of it watched (a series counts episodes, not files). */
  watchState: z.enum(['none', 'some', 'all']),
})
export type TitleSummary = z.infer<typeof TitleSummary>

export const TitleQuery = z.object({
  kind: TitleKind.optional(),
  /** Full-text search over titles, episode titles and path words (accent- and case-insensitive). */
  q: z.string().max(200).optional(),
  hideUnavailable: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
  sort: TitleSort.default('title'),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  cursor: z.string().optional(),
})
export type TitleQuery = z.input<typeof TitleQuery>

export const TitlePage = z.object({
  items: z.array(TitleSummary),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
})
export type TitlePage = z.infer<typeof TitlePage>

export const SeasonCoverage = z.object({
  season: z.number().int(),
  /** Episodes the provider lists for this season. */
  expected: z.number().int(),
  local: z.number().int(),
  missing: z.number().int(),
  upcoming: z.number().int(),
  undated: z.number().int(),
  /** Local files with a number the provider does not list for this season. */
  notInProvider: z.number().int(),
  /** Episodes covered by more than one file. */
  duplicates: z.number().int(),
})
export type SeasonCoverage = z.infer<typeof SeasonCoverage>

export const SeriesCoverage = z.object({
  seasons: z.array(SeasonCoverage),
  /** Files whose season/episode is not in the provider's list, or that have no number at all. */
  unmatchedFileIds: z.array(z.number().int()),
})
export type SeriesCoverage = z.infer<typeof SeriesCoverage>

export const TitleDetail = z.object({
  summary: TitleSummary,
  /** Every file of the title, episodes ordered by season then episode. */
  files: z.array(MediaFile),
  match: TitleMatch.nullable(),
  metadata: TitleMetadata.nullable(),
  /** Episode names and details from the provider; empty until the series is identified. */
  episodes: z.array(EpisodeInfo),
  /** Null unless the series is identified and the provider has its episodes. */
  coverage: SeriesCoverage.nullable(),
  /** Collections this title is part of (official and the person's own). */
  collections: z.array(CollectionRef),
  playback: PlaybackInfo,
})
export type TitleDetail = z.infer<typeof TitleDetail>
