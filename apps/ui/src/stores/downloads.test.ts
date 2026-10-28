import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useDownloadsStore } from './downloads'

const mock = vi.hoisted(() => ({ get: vi.fn(), event: null as null | ((event: object) => void) }))
vi.mock('./connection', () => ({ useConnectionStore: () => ({ phase: 'connected', client: { get: mock.get }, onEvent: (event: typeof mock.event) => { mock.event = event } }) }))
beforeEach(() => { mock.get.mockReset(); setActivePinia(createPinia()) })

it('offers release search only after a provider is configured, including temporarily unreachable providers', async () => {
  const status = { state: 'not_configured' as const, url: null, version: null, message: null }
  mock.get.mockResolvedValue(status)
  const store = useDownloadsStore()
  expect(store.canFindReleases).toBe(false)
  await store.load()
  expect(store.canFindReleases).toBe(false)
  store.indexer = { ...status, state: 'unreachable' }
  expect(store.canFindReleases).toBe(true)
  store.indexer = status
  store.client = { ...status, state: 'connected', username: null, webApiVersion: null }
  expect(store.canFindReleases).toBe(true)
  store.client = null
  expect(store.canFindReleases).toBe(false)
})

it('shares the status batch across components and preserves a newer pushed download list', async () => {
  let finish!: (value: object) => void
  const status = { state: 'not_configured', url: null, version: null, message: null }
  mock.get.mockImplementation((path: string) => path === '/downloads' ? new Promise(resolve => { finish = resolve }) : Promise.resolve(status))
  const store = useDownloadsStore() // the connection watcher starts the first batch
  const first = store.load()
  const second = store.load()
  expect(mock.get).toHaveBeenCalledTimes(3)
  const pushed = { reachable: true, items: [] }
  mock.event!({ type: 'downloads.changed', list: pushed })
  finish({ reachable: false, items: [] })
  await Promise.all([first, second])
  expect(store.list).toEqual(pushed)
  mock.get.mockResolvedValue(status)
  await store.load()
  expect(mock.get).toHaveBeenCalledTimes(6)
})
