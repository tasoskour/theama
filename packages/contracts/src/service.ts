import { z } from 'zod'
import { IsoDate } from './common'

export const SERVICE_NAME = 'Theama'

/** State of the Windows service as reported by the Service Control Manager. */
export const ServiceState = z.enum([
  'not-installed',
  'stopped',
  'start-pending',
  'running',
  'stop-pending',
  'paused',
  'unknown',
])
export type ServiceState = z.infer<typeof ServiceState>

export const ServiceHostKind = z.enum(['nssm', 'dev-process'])
export type ServiceHostKind = z.infer<typeof ServiceHostKind>

export const ServiceStatus = z.object({
  host: ServiceHostKind,
  state: ServiceState,
  serviceName: z.string(),
  /** Whether the API answered /health on the loopback port. */
  apiReachable: z.boolean(),
  pid: z.number().int().nullable(),
  account: z.string().nullable(),
  /** Human readable reason when something is wrong. */
  detail: z.string().nullable(),
})
export type ServiceStatus = z.infer<typeof ServiceStatus>

export const ServiceEventKind = z.enum(['start', 'stop', 'crash', 'restart', 'migrate'])
export type ServiceEventKind = z.infer<typeof ServiceEventKind>

export const ServiceEvent = z.object({
  id: z.number().int(),
  time: IsoDate,
  kind: ServiceEventKind,
  reason: z.string().nullable(),
  pid: z.number().int().nullable(),
  version: z.string().nullable(),
})
export type ServiceEvent = z.infer<typeof ServiceEvent>

export const ServiceEventList = z.object({ items: z.array(ServiceEvent) })
export type ServiceEventList = z.infer<typeof ServiceEventList>

/** Account the Windows service runs as, chosen at install time. */
export const ServiceAccountChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current-user') }),
  z.object({ kind: z.literal('local-system') }),
])
export type ServiceAccountChoice = z.infer<typeof ServiceAccountChoice>
