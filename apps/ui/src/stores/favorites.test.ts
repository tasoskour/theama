import { createPinia, setActivePinia } from 'pinia'
import { shallowReactive, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type FavoriteTitle, type ServerEvent } from '@theama/contracts'
import { useFavoritesStore } from './favorites'

const mock = vi.hoisted(() => ({ connection: null as unknown, get: vi.fn(), put: vi.fn(), delete: vi.fn(), listener: null as null | ((event: ServerEvent) => void) }))
vi.mock('./connection', () => ({ useConnectionStore: () => mock.connection }))
const movie: FavoriteTitle = { provider: 'tmdb', kind: 'movie', externalId: '42', title: 'Movie', originalTitle: null, overview: null, posterUrl: null, year: 2026, score: null, rating: 8, savedAt: '2026-01-01T00:00:00.000Z' }
let serverItems: FavoriteTitle[]

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  mock.connection = shallowReactive({ phase: 'connecting', client: { get: mock.get, put: mock.put, delete: mock.delete }, onEvent: (listener: (event: ServerEvent) => void) => { mock.listener = listener } })
  serverItems = []
  mock.get.mockImplementation(async (path: string) => ({ items: path.includes('favorites') ? serverItems : [] }))
  mock.put.mockImplementation(async () => { serverItems = [movie]; return movie })
  mock.delete.mockImplementation(async () => { serverItems = []; return { deleted: true } })
})

describe('shared favorites state', () => {
  it('matches provider, kind and external ID and refreshes on events and reconnect', async () => {
    const store = useFavoritesStore()
    mock.get.mockImplementation(async (path: string) => ({ items: path.includes('favorites') ? [movie] : [movie] }))
    await store.load()
    expect(store.isFavorite(movie)).toBe(true)
    expect(store.inLibrary(movie)).toBe(true)
    expect(store.inLibrary({ ...movie, kind: 'series' })).toBe(false)
    expect(store.isFavorite({ ...movie, provider: 'other' })).toBe(false)
    mock.get.mockClear()
    mock.listener!({ type: 'library.changed' })
    expect(mock.get).toHaveBeenCalledWith('/library/title-identities', expect.anything())
    mock.listener!({ type: 'favorites.changed' })
    expect(mock.get).toHaveBeenCalledWith('/downloads/favorites', expect.anything())
    mock.get.mockClear()
    ;(mock.connection as { phase: string }).phase = 'connected'
    await nextTick()
    expect(mock.get).toHaveBeenCalledTimes(2)
  })

  it('updates after a successful write, blocks duplicate clicks and discards stale reads', async () => {
    const store = useFavoritesStore()
    await store.load()
    let finish!: (item: FavoriteTitle) => void
    mock.put.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const saving = store.toggle(movie)
    expect(store.isPending(movie)).toBe(true)
    expect(store.isFavorite(movie)).toBe(false)
    await store.toggle(movie)
    expect(mock.put).toHaveBeenCalledOnce()
    let finishRead!: (value: { items: FavoriteTitle[] }) => void
    mock.get.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve }))
    const reading = store.loadFavorites()
    serverItems = [movie]
    finish(movie)
    await saving
    finishRead({ items: [] })
    await reading
    expect(store.isFavorite(movie)).toBe(true)
    expect(store.isPending(movie)).toBe(false)
    await store.toggle(movie)
    expect(mock.delete).toHaveBeenCalledWith('/downloads/favorites/tmdb/movie/42', expect.anything())
    expect(store.items).toEqual([])
  })

  it('keeps state after a failed mutation and retries the intended action', async () => {
    const store = useFavoritesStore()
    await store.load()
    mock.put.mockRejectedValueOnce(new Error('Offline'))
    await store.toggle(movie)
    expect(store.isFavorite(movie)).toBe(false)
    expect(store.error).toBe('Offline')
    await store.retry()
    expect(store.isFavorite(movie)).toBe(true)
    expect(store.error).toBeNull()
    mock.delete.mockRejectedValueOnce(new Error('Offline'))
    await store.toggle(movie)
    expect(store.isFavorite(movie)).toBe(true)
    await store.retry()
    expect(store.isFavorite(movie)).toBe(false)
  })

  it('loads newest-first server order and exposes initial-load failures for retry', async () => {
    const store = useFavoritesStore()
    mock.get.mockRejectedValueOnce(new Error('Unavailable'))
    await store.load()
    expect(store.loaded).toBe(false)
    expect(store.error).toBe('Unavailable')
    await store.toggle(movie)
    expect(mock.put).not.toHaveBeenCalled()
    mock.get.mockResolvedValueOnce({ items: [movie] })
    await store.retry()
    expect(store.loaded).toBe(true)
    expect(store.items).toEqual([movie])
    expect(store.error).toBeNull()
  })
})
