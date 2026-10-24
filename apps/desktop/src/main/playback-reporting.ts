import { ProgressResult } from '@theama/contracts'
import type { ReportProgress } from './position-tracking'
import type { ApiConnection } from './runtime'

/** Reject failed submissions so the tracker can retry its final report before offering the next episode. */
export function progressReporter(connection: () => Pick<ApiConnection, 'base' | 'token'> | null): ReportProgress<ProgressResult | undefined> {
  return async (fileId, sample, final) => {
    const conn = connection()
    if (!conn) throw new Error('Playback service is unavailable')
    const res = await fetch(`${conn.base}/api/v1/playback/files/${fileId}/progress`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${conn.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sample, final }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`Playback progress: HTTP ${res.status}`)
    return final ? ProgressResult.parse(await res.json()) : undefined
  }
}
