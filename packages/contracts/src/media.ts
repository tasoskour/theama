import { z } from 'zod'
import { IsoDate } from './common'

/** extra: featurettes, samples, trailers and similar bonus material (kept, hidden from the main lists). */
export const MediaKind = z.enum(['movie', 'episode', 'video', 'extra'])
export type MediaKind = z.infer<typeof MediaKind>

/**
 * available: present on an online source.
 * source_offline: its folder/drive cannot be reached right now (nothing is lost).
 * missing_unconfirmed: the source is online but the file is gone (kept until confirmed).
 */
export const FileState = z.enum(['available', 'source_offline', 'missing_unconfirmed'])
export type FileState = z.infer<typeof FileState>

export const MediaFile = z.object({
  id: z.number().int(),
  sourceId: z.number().int(),
  path: z.string(),
  fileName: z.string(),
  size: z.number(),
  modifiedAt: IsoDate,
  kind: MediaKind,
  /** Title guessed from the file name; never fetched from a database. */
  title: z.string(),
  year: z.number().int().nullable(),
  season: z.number().int().nullable(),
  episode: z.number().int().nullable(),
  episodeEnd: z.number().int().nullable(),
  episodeTitle: z.string().nullable(),
  state: FileState,
  /** False until FFprobe has looked at the file (or FFprobe is not installed). */
  probed: z.boolean(),
  durationMs: z.number().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  container: z.string().nullable(),
  videoCodec: z.string().nullable(),
  audioCodecs: z.array(z.string()),
  subtitleCount: z.number().int().nullable(),
  probeError: z.string().nullable(),
  firstSeenAt: IsoDate,
})
export type MediaFile = z.infer<typeof MediaFile>

export const MediaFileQuery = z.object({
  kind: MediaKind.optional(),
  sourceId: z.coerce.number().int().positive().optional(),
  /** Case-insensitive match against the guessed title and the file name. */
  q: z.string().max(200).optional(),
  hideUnavailable: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
})
export type MediaFileQuery = z.input<typeof MediaFileQuery>

export const MediaFilePage = z.object({
  items: z.array(MediaFile),
  nextCursor: z.string().nullable(),
  /** Matching files overall (ignores the cursor), for "N files" headings. */
  total: z.number().int(),
})
export type MediaFilePage = z.infer<typeof MediaFilePage>
