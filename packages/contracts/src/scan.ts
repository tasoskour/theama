import { z } from 'zod'
import { IsoDate } from './common'

export const ScanStatus = z.enum(['queued', 'running', 'done', 'failed', 'cancelled'])
export type ScanStatus = z.infer<typeof ScanStatus>

export const ScanSummary = z.object({
  /** Video files seen on disk. */
  found: z.number().int(),
  new: z.number().int(),
  changed: z.number().int(),
  moved: z.number().int(),
  /** Files no longer present on an online source (kept, flagged). */
  missing: z.number().int(),
  skipped: z.number().int(),
  probed: z.number().int(),
  errors: z.number().int(),
})
export type ScanSummary = z.infer<typeof ScanSummary>

export const EMPTY_SUMMARY: ScanSummary = { found: 0, new: 0, changed: 0, moved: 0, missing: 0, skipped: 0, probed: 0, errors: 0 }

export const ScanJob = z.object({
  id: z.number().int(),
  sourceId: z.number().int(),
  status: ScanStatus,
  startedAt: IsoDate.nullable(),
  finishedAt: IsoDate.nullable(),
  summary: ScanSummary,
  /** Human-readable notes: unreadable folders, FFprobe missing, why a scan was cut short. */
  diagnostics: z.array(z.string()),
})
export type ScanJob = z.infer<typeof ScanJob>

export const ScanJobList = z.object({ items: z.array(ScanJob) })
export type ScanJobList = z.infer<typeof ScanJobList>

export const ScanPhase = z.enum(['walking', 'probing', 'finalizing'])
export type ScanPhase = z.infer<typeof ScanPhase>

export const ScanProgress = z.object({
  jobId: z.number().int(),
  sourceId: z.number().int(),
  phase: ScanPhase,
  found: z.number().int(),
  /** Files that need FFprobe in this scan, and how many are done. */
  toProbe: z.number().int(),
  probed: z.number().int(),
})
export type ScanProgress = z.infer<typeof ScanProgress>

/** Whether technical info can be extracted (FFprobe found). Reported with the library status. */
export const LibraryStatus = z.object({
  ffprobeAvailable: z.boolean(),
  fileCount: z.number().int(),
  scanning: z.boolean(),
})
export type LibraryStatus = z.infer<typeof LibraryStatus>
