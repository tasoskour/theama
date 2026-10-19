import { z } from 'zod'
import { IsoDate } from './common'
import { LogEntry } from './logs'
import { AppSettings } from './settings'

/** Messages pushed from the server over the WebSocket at /api/v1/events. */
export const ServerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), version: z.string(), time: IsoDate }),
  z.object({ type: z.literal('heartbeat'), time: IsoDate }),
  z.object({ type: z.literal('settings.changed'), settings: AppSettings }),
  z.object({ type: z.literal('log.appended'), entry: LogEntry }),
  z.object({ type: z.literal('library.changed') }),
])
export type ServerEvent = z.infer<typeof ServerEvent>

/** Heartbeat interval; clients treat 2.5 missed beats as a lost connection. */
export const HEARTBEAT_INTERVAL_MS = 5000
