import { z } from 'zod'
import { IsoDate } from './common'
import { MediaKind, SubtitleTrack } from './media'
import { TitleSummary } from './titles'

/** Everything the desktop shell needs to start a player on one file; the shell never takes a path from the UI. */
export const LaunchInfo = z.object({
  fileId: z.number().int(),
  path: z.string(),
  fileName: z.string(),
  title: z.string(),
  kind: MediaKind,
  /** An external subtitle file chosen from the language preferences, if one sits next to the video. */
  subtitle: z.object({ path: z.string(), language: z.string().nullable() }).nullable(),
  /** The preferred subtitle languages, most wanted first (ISO 639-1). */
  subtitleLanguages: z.array(z.string()),
})
export type LaunchInfo = z.infer<typeof LaunchInfo>

export const ExternalSubtitle = z.object({
  path: z.string(),
  fileName: z.string(),
  format: z.string(),
  /** ISO 639-1, from a tag in the file name; null when it cannot be told. */
  language: z.string().nullable(),
  forced: z.boolean(),
  /** For the deaf and hard of hearing. */
  sdh: z.boolean(),
})
export type ExternalSubtitle = z.infer<typeof ExternalSubtitle>

export const FileSubtitles = z.object({
  embedded: z.array(SubtitleTrack),
  external: z.array(ExternalSubtitle),
  /** The external file a player would be started with, given the language preferences. */
  chosen: ExternalSubtitle.nullable(),
  preferred: z.array(z.string()),
})
export type FileSubtitles = z.infer<typeof FileSubtitles>

export const SetWatchedRequest =z.object({ watched: z.boolean() })
export type SetWatchedRequest = z.infer<typeof SetWatchedRequest>

/** Marks a whole title (or one season of a series) watched or unwatched. */
export const SetTitleWatchedRequest = z.object({
  key: z.string().min(1).max(1000),
  watched: z.boolean(),
  /** Only this season (0 = specials). Omit for the whole title. */
  season: z.number().int().min(0).nullable().optional(),
})
export type SetTitleWatchedRequest = z.infer<typeof SetTitleWatchedRequest>

export const ContinueItem = z.object({
  summary: TitleSummary,
  /** The file to play now. */
  fileId: z.number().int(),
  /** `S02E03` for a series; null for a film. */
  label: z.string().nullable(),
  lastActivityAt: IsoDate,
})
export type ContinueItem = z.infer<typeof ContinueItem>

export const ContinueList = z.object({ items: z.array(ContinueItem) })
export type ContinueList = z.infer<typeof ContinueList>
