import { z } from 'zod'
import { IsoDate } from './common'

export const HostMode = z.enum(['service', 'foreground'])
export type HostMode = z.infer<typeof HostMode>

export const HealthResponse = z.object({
  status: z.literal('ok'),
  time: IsoDate,
})
export type HealthResponse = z.infer<typeof HealthResponse>

export const SystemInfo = z.object({
  version: z.string(),
  nodeVersion: z.string(),
  pid: z.number().int(),
  startedAt: IsoDate,
  uptimeSeconds: z.number(),
  hostMode: HostMode,
  paths: z.object({
    dataDir: z.string(),
    databaseFile: z.string(),
    cacheDir: z.string(),
    logsDir: z.string(),
  }),
  schemaVersion: z.number().int(),
})
export type SystemInfo = z.infer<typeof SystemInfo>

/** Written by the server to runtime.json so the desktop shell can find it. */
export const RuntimeInfo = z.object({
  port: z.number().int(),
  pid: z.number().int(),
  startedAt: IsoDate,
  hostMode: HostMode,
  version: z.string(),
})
export type RuntimeInfo = z.infer<typeof RuntimeInfo>
