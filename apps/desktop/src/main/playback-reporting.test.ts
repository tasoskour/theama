import { afterEach, describe, expect, it, vi } from 'vitest'
import { progressReporter } from './playback-reporting'

afterEach(() => vi.unstubAllGlobals())

describe('progressReporter', () => {
  const sample = { positionSeconds: 2600, durationSeconds: 2700 }
  const connection = () => ({ base: 'http://127.0.0.1:47890', token: 'test-token' })

  it('forwards authenticated progress and returns the confirmed next episode only on the final report', async () => {
    const result = { outcome: 'watched', nextUp: { next: { fileId: 2, season: 1, episode: 2, label: 'S01E02', resumeSeconds: null }, title: 'Show', countdownSeconds: 5 } }
    const fetchMock = vi.fn(async () => Response.json(result))
    vi.stubGlobal('fetch', fetchMock)
    const report = progressReporter(connection)
    expect(await report(1, sample, false)).toBeUndefined()
    expect(await report(1, sample, true)).toEqual(result)
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:47890/api/v1/playback/files/1/progress', expect.objectContaining({
      method: 'PUT', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sample, final: true }), signal: expect.any(AbortSignal),
    }))
  })

  it.each([false, true])('rejects unsuccessful HTTP responses (final: %s)', async (final) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 })))
    await expect(progressReporter(connection)(1, sample, final)).rejects.toThrow('HTTP 503')
  })

  it('rejects an invalid final response instead of silently losing the next-episode prompt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
    await expect(progressReporter(connection)(1, sample, true)).rejects.toThrow()
  })

  it('rejects a missing connection so the final report can retry after reconnection', async () => {
    await expect(progressReporter(() => null)(1, sample, true)).rejects.toThrow('unavailable')
  })
})
