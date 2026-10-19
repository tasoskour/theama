import { z } from 'zod'
import { IsoDate, LogLevel } from './common'

/** Where a log line came from. */
export const LogSource = z.enum(['app', 'service-stdout', 'service-stderr'])
export type LogSource = z.infer<typeof LogSource>

export const LogEntry = z.object({
  /** Stable within a read: source:file:offset. Used as a list key. */
  id: z.string(),
  time: IsoDate,
  level: LogLevel,
  source: LogSource,
  message: z.string(),
  /** Free-form structured fields attached to the log line. */
  context: z.record(z.string(), z.unknown()).optional(),
})
export type LogEntry = z.infer<typeof LogEntry>

export const LogQuery = z.object({
  /** Minimum level (inclusive). */
  level: LogLevel.optional(),
  source: LogSource.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  /** Case-insensitive substring match against the message. */
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** Opaque cursor returned by the previous page. */
  cursor: z.string().optional(),
})
export type LogQuery = z.infer<typeof LogQuery>

export const LogPage = z.object({
  items: z.array(LogEntry),
  nextCursor: z.string().nullable(),
})
export type LogPage = z.infer<typeof LogPage>
