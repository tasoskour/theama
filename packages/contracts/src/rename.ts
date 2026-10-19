import { z } from 'zod'
import { IsoDate } from './common'

export const DEFAULT_MOVIE_TEMPLATE = '{title} ({year})'
export const DEFAULT_EPISODE_TEMPLATE = '{title} - {episodeCode} - {episodeTitle}'

/** Names a template may use. `{season:00}` pads to two digits. */
export const TEMPLATE_TOKENS = ['title', 'year', 'season', 'episode', 'episodeCode', 'episodeTitle', 'resolution', 'videoCodec'] as const

export const Template = z.string().trim().min(1).max(200)

export const RenamePreviewRequest = z.object({
  /** The titles whose files to rename. */
  keys: z.array(z.string().min(1).max(1000)).min(1).max(200),
  movieTemplate: Template.optional(),
  episodeTemplate: Template.optional(),
})
export type RenamePreviewRequest = z.infer<typeof RenamePreviewRequest>

/**
 * ok: will be renamed. unchanged: already named this way. collision_exists: something else is already there.
 * collision_batch: two files in this rename want the same name. too_long: the path would exceed Windows limits.
 * unavailable: its drive is offline. missing: the file is gone. skipped: it lacks what the template needs (an episode number).
 * changed: apply only; the plan moved on since the preview.
 */
export const RenameStatus = z.enum(['ok', 'unchanged', 'collision_exists', 'collision_batch', 'too_long', 'unavailable', 'missing', 'skipped', 'changed'])
export type RenameStatus = z.infer<typeof RenameStatus>

export const RenameItem = z.object({
  /** The library file (for a video). Null for a subtitle that travels with it. */
  fileId: z.number().int().nullable(),
  kind: z.enum(['video', 'subtitle']),
  titleKey: z.string(),
  from: z.string(),
  to: z.string(),
  fromName: z.string(),
  toName: z.string(),
  status: RenameStatus,
})
export type RenameItem = z.infer<typeof RenameItem>

export const RenamePreview = z.object({
  items: z.array(RenameItem),
  /** Counts by status, for the summary line. */
  counts: z.record(z.string(), z.number().int()),
})
export type RenamePreview = z.infer<typeof RenamePreview>

export const RenameApplyRequest = RenamePreviewRequest.extend({
  /** Exactly the renames the person approved, as shown in the preview. Anything that no longer matches is skipped. */
  approved: z.array(z.object({ from: z.string(), to: z.string() })).min(1).max(5000),
})
export type RenameApplyRequest = z.infer<typeof RenameApplyRequest>

export const RenameApplyResult = z.object({
  /** What was done, with the undo handle. Null if nothing could be renamed. */
  batch: z.lazy(() => OperationBatch).nullable(),
  /** Approved renames that no longer matched the plan (a file changed since the preview) and were left alone. */
  changed: z.number().int(),
})
export type RenameApplyResult = z.infer<typeof RenameApplyResult>

export const OperationStatus = z.enum(['pending', 'done', 'failed', 'rolled_back', 'rollback_failed'])
export type OperationStatus = z.infer<typeof OperationStatus>

export const OperationItem = z.object({
  id: z.number().int(),
  kind: z.enum(['video', 'subtitle']),
  from: z.string(),
  to: z.string(),
  status: OperationStatus,
  error: z.string().nullable(),
})
export type OperationItem = z.infer<typeof OperationItem>

export const OperationBatch = z.object({
  id: z.string(),
  createdAt: IsoDate,
  total: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  rolledBack: z.number().int(),
  /** At least one rename is still in effect and can be undone. */
  canRollback: z.boolean(),
  items: z.array(OperationItem),
})
export type OperationBatch = z.infer<typeof OperationBatch>

export const OperationList = z.object({ items: z.array(OperationBatch) })
export type OperationList = z.infer<typeof OperationList>
