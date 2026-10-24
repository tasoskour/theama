import { join } from 'node:path'
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
  /** Point the metadata provider somewhere else (tests, a local mirror). Defaults to TMDB itself. */
  THEAMA_TMDB_API_BASE: z.string().url().optional(),
  THEAMA_TMDB_IMAGE_BASE: z.string().url().optional(),
  THEAMA_OPENSUBTITLES_API_BASE: z.string().url().optional(),
  THEAMA_SUBDL_API_BASE: z.string().url().optional(),
  THEAMA_SUBDL_DOWNLOAD_BASE: z.string().url().optional(),
})

export interface ServerConfig {
  dataDir: string
  databaseFile: string
  cacheDir: string
  logsDir: string
  secretsDir: string
  artworkDir: string
  /** Where backups of the database are kept. */
  backupsDir: string
  /** Where a restore waits for the next start. */
  restoreDir: string
  tmdbKeyFile: string
  /** The qBittorrent address and login, as JSON. */
  downloadClientFile: string
  /** The Prowlarr address and API key, as JSON. */
  indexerFile: string
  tmdbApiBase?: string
  tmdbImageBase?: string
  openSubtitlesApiBase?: string
  subdlApiBase?: string
  subdlDownloadBase?: string
  tokenFile: string
  runtimeFile: string
  port: number
  hostMode: HostMode
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  /** The level was set explicitly in the environment, so the saved "log detail" setting does not override it. */
  logLevelPinned: boolean
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
    artworkDir: join(paths.cacheDir, 'artwork'),
    backupsDir: join(paths.dataDir, 'backups'),
    restoreDir: join(paths.dataDir, 'restore'),
    tmdbKeyFile: join(paths.secretsDir, 'tmdb.key'),
    downloadClientFile: join(paths.secretsDir, 'qbittorrent.json'),
    indexerFile: join(paths.secretsDir, 'prowlarr.json'),
    ...(parsed.THEAMA_TMDB_API_BASE ? { tmdbApiBase: parsed.THEAMA_TMDB_API_BASE } : {}),
    ...(parsed.THEAMA_TMDB_IMAGE_BASE ? { tmdbImageBase: parsed.THEAMA_TMDB_IMAGE_BASE } : {}),
    ...(parsed.THEAMA_OPENSUBTITLES_API_BASE ? { openSubtitlesApiBase: parsed.THEAMA_OPENSUBTITLES_API_BASE } : {}),
    ...(parsed.THEAMA_SUBDL_API_BASE ? { subdlApiBase: parsed.THEAMA_SUBDL_API_BASE } : {}),
    ...(parsed.THEAMA_SUBDL_DOWNLOAD_BASE ? { subdlDownloadBase: parsed.THEAMA_SUBDL_DOWNLOAD_BASE } : {}),
    port: parsed.THEAMA_PORT,
    hostMode: parsed.THEAMA_HOST_MODE,
    logLevel: parsed.THEAMA_LOG_LEVEL,
    logLevelPinned: env.THEAMA_LOG_LEVEL !== undefined,
    allowedOrigins: [...BASE_ALLOWED_ORIGINS, ...extra],
  }
}
