import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiClient } from './client'

afterEach(() => vi.unstubAllGlobals())

it('forwards cancellation without turning it into a network or schema error', async () => {
  const controller = new AbortController()
  const aborted = new DOMException('Cancelled', 'AbortError')
  const fetch = vi.fn(async (_url: URL, options: RequestInit) => {
    expect(options.signal).toBe(controller.signal)
    return { ok: true, json: async () => { controller.abort(); throw aborted } }
  })
  vi.stubGlobal('fetch', fetch)
  await expect(new ApiClient('http://localhost').get('/health', z.object({}), undefined, { signal: controller.signal })).rejects.toBe(aborted)
})
