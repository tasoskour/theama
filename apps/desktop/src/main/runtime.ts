import { existsSync, readFileSync } from 'node:fs'
import { RuntimeInfo, type HealthResponse } from '@theama/contracts'
import { API_PREFIX, HealthResponse as HealthSchema } from '@theama/contracts'
import type { DataPaths } from '@theama/logs'

export interface ApiConnection {
  port: number
  pid: number
  token: string
  base: string
  wsUrl: string
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to another account (the service).
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Reads where the backend is listening and the credential for it. A stale
 * runtime.json left behind by a crashed server is ignored by checking its pid.
 */
export function readConnection(paths: Pick<DataPaths, 'runtimeFile' | 'tokenFile'>): ApiConnection | null {
  try {
    if (!existsSync(paths.runtimeFile) || !existsSync(paths.tokenFile)) return null
    const runtime = RuntimeInfo.parse(JSON.parse(readFileSync(paths.runtimeFile, 'utf8')))
    if (!processAlive(runtime.pid)) return null
    const token = readFileSync(paths.tokenFile, 'utf8').trim()
    if (!token) return null
    const base = `http://127.0.0.1:${runtime.port}`
    return { port: runtime.port, pid: runtime.pid, token, base, wsUrl: `ws://127.0.0.1:${runtime.port}${API_PREFIX}/events` }
  } catch {
    return null
  }
}

/** True if the API answers /health with a valid token. */
export async function probeHealth(conn: ApiConnection, timeoutMs = 1500): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${conn.base}${API_PREFIX}/health`, {
      headers: { Authorization: `Bearer ${conn.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    return HealthSchema.parse(await res.json())
  } catch {
    return null
  }
}
