import { afterEach, expect, it, vi } from 'vitest'
import { MetadataManager, type ManagerDeps } from './manager'
import type { ProviderCandidate } from './provider'

afterEach(() => vi.useRealTimers())

it('shares a suggestion request, limits artwork to four tasks and keeps provider ordering', async () => {
  vi.useFakeTimers()
  let running = 0
  let peak = 0
  const candidates: ProviderCandidate[] = Array.from({ length: 8 }, (_, index) => ({
    externalId: String(index), kind: 'movie', title: `Title ${index}`, originalTitle: null, year: 2020,
    overview: null, posterPath: `/poster-${index}.jpg`, popularity: 1, rating: 7,
  }))
  const suggestions = vi.fn(async () => ({ items: candidates, hasMore: false }))
  const ensure = vi.fn(async (path: string) => {
    running++
    peak = Math.max(peak, running)
    const index = Number(path.match(/\d+/)![0])
    await new Promise(resolve => setTimeout(resolve, (8 - index) * 5))
    running--
    return index === 3 ? null : `thumb-poster-${index}.jpg`
  })
  // These are the only dependencies used by the read-only suggestion path.
  const manager = new MetadataManager({ provider: { id: 'tmdb', suggestions }, artwork: { ensure }, credentials: { has: () => true }, language: () => 'en' } as unknown as ManagerDeps)
  const query = { section: 'new' as const, page: 1 }
  const first = manager.suggestions(query)
  const second = manager.suggestions(query)
  await vi.runAllTimersAsync()
  const [a, b] = await Promise.all([first, second])
  expect(suggestions).toHaveBeenCalledOnce()
  expect(ensure).toHaveBeenCalledTimes(8)
  expect(peak).toBe(4)
  expect(a).toEqual(b)
  expect(a.items.map(item => item.externalId)).toEqual(candidates.map(item => item.externalId))
  expect(a.items[3]!.posterUrl).toBeNull()
})
