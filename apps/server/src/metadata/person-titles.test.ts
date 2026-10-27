import { expect, it, vi } from 'vitest'
import { MetadataManager, MetadataProblem, type ManagerDeps } from './manager'
import { ProviderError, type ProviderCandidate } from './provider'

it('shares person lookups, caches local artwork, and separates role, language and expiry', async () => {
  let clock = 0
  let language: 'en' | 'el' = 'en'
  const candidate: ProviderCandidate = { externalId: '7', kind: 'movie', title: 'Movie', originalTitle: null, year: null, overview: null, posterPath: '/movie.jpg', popularity: 10, rating: 8 }
  const personTitles = vi.fn(async () => [candidate])
  const ensure = vi.fn(async () => 'thumb-movie.jpg')
  const manager = new MetadataManager({
    provider: { id: 'tmdb', personTitles }, artwork: { ensure }, credentials: { has: () => true },
    language: () => language, now: () => new Date(clock),
  } as unknown as ManagerDeps)
  const [first, second] = await Promise.all([manager.personTitles('42', 'actor'), manager.personTitles('42', 'actor')])
  expect(first).toEqual(second)
  expect(first.items[0]).toMatchObject({ posterUrl: '/api/v1/artwork/thumb-movie.jpg', rating: 8, score: null })
  await manager.personTitles('42', 'actor')
  expect(personTitles).toHaveBeenCalledOnce()
  expect(ensure).toHaveBeenCalledOnce()
  await manager.personTitles('42', 'director')
  language = 'el'
  await manager.personTitles('42', 'actor')
  expect(personTitles).toHaveBeenLastCalledWith('42', 'actor', 'el-GR')
  clock = 3_600_001
  await manager.personTitles('42', 'actor')
  expect(personTitles).toHaveBeenCalledTimes(4)
})

it('requires credentials and allows retry after provider failures', async () => {
  let configured = false
  const personTitles = vi.fn().mockRejectedValueOnce(new ProviderError('unavailable', 'Offline')).mockResolvedValue([])
  const manager = new MetadataManager({
    provider: { id: 'tmdb', personTitles }, credentials: { has: () => configured }, language: () => 'en',
  } as unknown as ManagerDeps)
  await expect(manager.personTitles('42', 'actor')).rejects.toMatchObject({ code: 'no_key' })
  expect(personTitles).not.toHaveBeenCalled()
  configured = true
  await expect(manager.personTitles('42', 'actor')).rejects.toBeInstanceOf(MetadataProblem)
  await expect(manager.personTitles('42', 'actor')).resolves.toEqual({ items: [] })
  expect(personTitles).toHaveBeenCalledTimes(2)
})
