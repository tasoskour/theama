import { z } from 'zod'

/** Prefix shared by every REST endpoint. */
export const API_PREFIX = '/api/v1'

export const LogLevel = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
export type LogLevel = z.infer<typeof LogLevel>

/** Ordered from least to most severe. */
export const LOG_LEVEL_ORDER: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiError = z.infer<typeof ApiError>

export const IsoDate = z.string().datetime({ offset: true })

/** Whether a title must match any selected genre or every selected genre. */
export const GenreMode = z.enum(['any', 'all'])
export type GenreMode = z.infer<typeof GenreMode>
