import { z } from 'zod'
import { IsoDate } from './common'
import { DownloadList } from './downloads'
import { LogEntry } from './logs'
import { MetadataStatus } from './metadata'
import { ScanJob, ScanProgress } from './scan'
import { AppSettings } from './settings'

/** Messages pushed from the server over the WebSocket at /api/v1/events. */
export const ServerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), version: z.string(), time: IsoDate }),
  z.object({ type: z.literal('heartbeat'), time: IsoDate }),
  z.object({ type: z.literal('settings.changed'), settings: AppSettings }),
  z.object({ type: z.literal('log.appended'), entry: LogEntry }),
  z.object({ type: z.literal('library.changed') }),
  z.object({ type: z.literal('favorites.changed') }),
  z.object({ type: z.literal('scan.started'), job: ScanJob }),
  z.object({ type: z.literal('scan.progress'), progress: ScanProgress }),
  z.object({ type: z.literal('scan.finished'), job: ScanJob }),
  z.object({ type: z.literal('metadata.status'), status: MetadataStatus }),
  z.object({ type: z.literal('downloads.changed'), list: DownloadList }),
])
export type ServerEvent = z.infer<typeof ServerEvent>

/** Heartbeat interval; clients treat 2.5 missed beats as a lost connection. */
export const HEARTBEAT_INTERVAL_MS = 5000
