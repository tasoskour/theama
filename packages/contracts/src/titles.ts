import { z } from 'zod'
import { IsoDate } from './common'
import { MediaFile } from './media'
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

export const TitleDetail = z.object({
  summary: TitleSummary,
  /** Every file of the title, episodes ordered by season then episode. */
  files: z.array(MediaFile),
  match: TitleMatch.nullable(),
  metadata: TitleMetadata.nullable(),
  /** Episode names and details from the provider; empty until the series is identified. */
  episodes: z.array(EpisodeInfo),
})
export type TitleDetail = z.infer<typeof TitleDetail>
