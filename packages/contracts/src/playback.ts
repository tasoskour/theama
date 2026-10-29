import { z } from 'zod'
import { IsoDate } from './common'
import { MediaKind, SubtitleTrack } from './media'
import { NextEpisode } from './playback-info'
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
  /** Where to start (seconds) so the person carries on where they stopped; null to start from the beginning. */
  resumeSeconds: z.number().int().nullable(),
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

/** Result of taking a title off the "continue watching" rail. */
export const DismissContinueResult = z.object({ ok: z.literal(true) })
export type DismissContinueResult = z.infer<typeof DismissContinueResult>

/**
 * What a player reports while it plays, forwarded by the desktop shell. The server decides what it means:
 * unfinished playback below `MIN_TRACKED_SECONDS` is not kept, and near the end the file counts as watched.
 */
export const ProgressRequest = z.object({
  // Keep player precision for completion checks; saved resume positions are rounded by the repository.
  positionSeconds: z.number().min(0).max(1_000_000),
  durationSeconds: z.number().positive().max(1_000_000).nullable().default(null),
  /** Last report of this viewing: the file finished, changed, or the player closed. */
  final: z.boolean().default(false),
})
export type ProgressRequest = z.input<typeof ProgressRequest>

/** An episode just ended and the next one is ready to start after a short countdown. */
export const NextUp = z.object({
  next: NextEpisode,
  /** Series title, for the prompt. */
  title: z.string(),
  countdownSeconds: z.number().int().min(0).max(30),
})
export type NextUp = z.infer<typeof NextUp>

export const ProgressResult = z.object({
  outcome: z.enum(['ignored', 'saved', 'watched']),
  /** Only on the last report of a viewing that reached the end, when "play next episode" is on and one follows. */
  nextUp: NextUp.optional(),
})
export type ProgressResult = z.infer<typeof ProgressResult>

/** Unfinished playback shorter than this is not remembered. */
export const MIN_TRACKED_SECONDS = 5 * 60
/** From this share of the runtime on, a file counts as watched. */
export const WATCHED_FRACTION = 0.9

export const ContinueItem = z.object({
  summary: TitleSummary,
  /** The file to play now. */
  fileId: z.number().int(),
  /** `S02E03` for a series; null for a film. */
  label: z.string().nullable(),
  /** Where playback stopped last time (seconds), if it is worth resuming. */
  resumeSeconds: z.number().int().nullable(),
  lastActivityAt: IsoDate,
})
export type ContinueItem = z.infer<typeof ContinueItem>

export const ContinueList = z.object({ items: z.array(ContinueItem) })
export type ContinueList = z.infer<typeof ContinueList>
