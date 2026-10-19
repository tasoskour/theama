import { z } from 'zod'
import { HostMode } from '@theama/contracts'
import { defaultDataDir, resolveDataPaths } from '@theama/logs'

const EnvSchema = z.object({
  THEAMA_DATA_DIR: z.string().min(1).optional(),
  THEAMA_PORT: z.coerce.number().int().min(0).max(65535).default(47890),
  THEAMA_HOST_MODE: HostMode.default('foreground'),
  THEAMA_LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  /** Extra browser origins allowed to call the API (dev servers). Comma separated. */
  THEAMA_EXTRA_ORIGINS: z.string().optional(),
})

export interface ServerConfig {
  dataDir: string
  databaseFile: string
  cacheDir: string
  logsDir: string
  secretsDir: string
  tokenFile: string
  runtimeFile: string
  port: number
  hostMode: HostMode
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  allowedOrigins: string[]
}

/** Origins that may call the API from a browser context. */
export const BASE_ALLOWED_ORIGINS = ['app://theama']

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvSchema.parse(env)
  const paths = resolveDataPaths(parsed.THEAMA_DATA_DIR ?? defaultDataDir(env))
  const extra = (parsed.THEAMA_EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    ...paths,
    port: parsed.THEAMA_PORT,
    hostMode: parsed.THEAMA_HOST_MODE,
    logLevel: parsed.THEAMA_LOG_LEVEL,
    allowedOrigins: [...BASE_ALLOWED_ORIGINS, ...extra],
  }
}
