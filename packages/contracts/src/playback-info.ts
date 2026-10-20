import { z } from 'zod'
import { IsoDate } from './common'

export const NextEpisode = z.object({
  fileId: z.number().int(),
  season: z.number().int(),
  episode: z.number().int(),
  /** `S02E03`. */
  label: z.string(),
  /** Where playback stopped last time (seconds), when it is worth resuming; null otherwise. */
  resumeSeconds: z.number().int().nullable(),
})
export type NextEpisode = z.infer<typeof NextEpisode>

export const PlaybackInfo = z.object({
  /** Series: the first unwatched local episode after the last one watched. Null when everything is watched. */
  next: NextEpisode.nullable(),
  lastPlayedAt: IsoDate.nullable(),
})
export type PlaybackInfo = z.infer<typeof PlaybackInfo>
