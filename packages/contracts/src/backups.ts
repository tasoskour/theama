import { z } from 'zod'
import { IsoDate } from './common'

/**
 * manual: made on request, never deleted automatically. daily: made by Theama about once a day.
 * pre-migration: made just before the database is upgraded to a newer layout. pre-restore: made just before a restore replaces it.
 */
export const BackupKind = z.enum(['manual', 'daily', 'pre-migration', 'pre-restore'])
export type BackupKind = z.infer<typeof BackupKind>

export const BackupInfo = z.object({
  /** File name inside the backups folder; this is also its id. */
  name: z.string(),
  kind: BackupKind,
  createdAt: IsoDate,
  size: z.number(),
  /** The database layout version it was made with. */
  schemaVersion: z.number().int(),
})
export type BackupInfo = z.infer<typeof BackupInfo>

export const PendingRestore = z.object({
  /** What will be restored: a backup's name, or the file name of an outside file. */
  source: z.string(),
  schemaVersion: z.number().int(),
  stagedAt: IsoDate,
  /** What the backup holds, so the person can recognise it before restarting. */
  summary: z.object({ files: z.number().int(), titles: z.number().int(), collections: z.number().int() }),
})
export type PendingRestore = z.infer<typeof PendingRestore>

export const BackupList = z.object({
  items: z.array(BackupInfo),
  /** A restore that is waiting for the service to restart. */
  pending: PendingRestore.nullable(),
  directory: z.string(),
})
export type BackupList = z.infer<typeof BackupList>

/** Either a backup from the list (`name`) or a file from elsewhere (`path`, e.g. one chosen with the file picker). */
export const RestoreRequest = z
  .object({
    name: z.string().min(1).max(200).optional(),
    path: z.string().min(1).max(32_000).optional(),
  })
  .refine((v) => (v.name === undefined) !== (v.path === undefined), { message: 'Give either a backup name or a file path' })
export type RestoreRequest = z.infer<typeof RestoreRequest>
