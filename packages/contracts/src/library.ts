import { z } from 'zod'
import { IsoDate } from './common'

export const LibraryType = z.enum(['movies', 'series', 'videos', 'auto'])
export type LibraryType = z.infer<typeof LibraryType>

/** unknown: not checked yet. offline: unreachable or a different volume is mounted there. */
export const SourceAvailability = z.enum(['online', 'offline', 'unknown'])
export type SourceAvailability = z.infer<typeof SourceAvailability>

export const LibrarySource = z.object({
  id: z.number().int(),
  path: z.string(),
  libraryType: LibraryType,
  recursive: z.boolean(),
  enabled: z.boolean(),
  volumeId: z.string().nullable(),
  availability: SourceAvailability,
  lastSeenOnlineAt: IsoDate.nullable(),
  createdAt: IsoDate,
})
export type LibrarySource = z.infer<typeof LibrarySource>

export const LibrarySourceList = z.object({ items: z.array(LibrarySource) })
export type LibrarySourceList = z.infer<typeof LibrarySourceList>

export const CreateSourceRequest = z.object({
  path: z.string().min(1).max(32_000),
  libraryType: LibraryType.default('auto'),
  recursive: z.boolean().default(true),
})
export type CreateSourceRequest = z.input<typeof CreateSourceRequest>

export const UpdateSourceRequest = z.object({
  libraryType: LibraryType.optional(),
  recursive: z.boolean().optional(),
  enabled: z.boolean().optional(),
})
export type UpdateSourceRequest = z.infer<typeof UpdateSourceRequest>

/** Points an existing folder at a new location (its drive got another letter, or its files were moved). */
export const RelocateSourceRequest = z.object({
  path: z.string().min(1).max(32_000),
})
export type RelocateSourceRequest = z.infer<typeof RelocateSourceRequest>

export const ExclusionKind = z.enum(['file', 'folder'])
export type ExclusionKind = z.infer<typeof ExclusionKind>

/** A file or subfolder deliberately left out of a library source. */
export const LibraryExclusion = z.object({
  id: z.number().int(),
  sourceId: z.number().int(),
  path: z.string(),
  kind: ExclusionKind,
  createdAt: IsoDate,
})
export type LibraryExclusion = z.infer<typeof LibraryExclusion>

export const LibraryExclusionList = z.object({ items: z.array(LibraryExclusion) })
export type LibraryExclusionList = z.infer<typeof LibraryExclusionList>

export const CreateExclusionRequest = z.object({
  path: z.string().min(1).max(32_000),
  kind: ExclusionKind,
})

export const HiddenResult = z.object({ hidden: z.number().int().nonnegative() })
export type HiddenResult = z.infer<typeof HiddenResult>
