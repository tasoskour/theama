import { homedir } from 'node:os'
import { join } from 'node:path'

export interface DataPaths {
  dataDir: string
  databaseFile: string
  cacheDir: string
  logsDir: string
  secretsDir: string
  tokenFile: string
  runtimeFile: string
}

/**
 * Machine-wide data directory shared by the service and the desktop app.
 * It lives outside the install folder so upgrades never touch user data.
 */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.THEAMA_DATA_DIR) return env.THEAMA_DATA_DIR
  const programData = env.ProgramData
  return programData ? join(programData, 'Theama') : join(homedir(), '.theama')
}

export function resolveDataPaths(dataDir: string): DataPaths {
  return {
    dataDir,
    databaseFile: join(dataDir, 'data', 'theama.db'),
    cacheDir: join(dataDir, 'cache'),
    logsDir: join(dataDir, 'logs'),
    secretsDir: join(dataDir, 'secrets'),
    tokenFile: join(dataDir, 'secrets', 'api-token'),
    runtimeFile: join(dataDir, 'runtime.json'),
  }
}
