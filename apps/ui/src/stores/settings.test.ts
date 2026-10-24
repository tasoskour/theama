import { createPinia, setActivePinia } from 'pinia'
import { shallowReactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type ServerEvent } from '@theama/contracts'
import { readCachedPrefs } from '@/i18n'
import { useSettingsStore } from './settings'

const mock = vi.hoisted(() => ({ connection: null as unknown, get: vi.fn(), put: vi.fn(), listener: null as null | ((event: ServerEvent) => void) }))
vi.mock('./connection', () => ({ useConnectionStore: () => mock.connection }))
vi.mock('@/api/bridge', () => ({ getBridge: () => null }))

let storage: Map<string, string>

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  vi.stubGlobal('document', { documentElement: { lang: '' } })
  mock.connection = shallowReactive({ phase: 'connecting', client: { get: mock.get, put: mock.put }, onEvent: (listener: (event: ServerEvent) => void) => { mock.listener = listener } })
})

afterEach(() => vi.unstubAllGlobals())

describe('text size settings', () => {
  it('restores a cached preference before the service responds', () => {
    storage.set('theama.prefs', JSON.stringify({ theme: 'light', textSize: 'extra-large' }))
    const store = useSettingsStore()
    expect(store.loaded).toBe(false)
    expect(store.settings.textSize).toBe('extra-large')
    expect(store.settings.theme).toBe('light')
  })

  it('uses Default for missing, corrupt, or invalid cached text sizes', () => {
    for (const value of ['{}', '{"textSize":"huge","theme":"light"}', 'null', '[]', '{broken']) {
      storage.set('theama.prefs', value)
      expect(readCachedPrefs().textSize ?? DEFAULT_SETTINGS.textSize).toBe('default')
    }
    storage.set('theama.prefs', '{"textSize":130,"theme":"light"}')
    expect(useSettingsStore().settings).toMatchObject({ textSize: 'default', theme: 'light' })
  })

  it('previews immediately and caches the successful server response', async () => {
    const store = useSettingsStore()
    let finish!: (settings: typeof DEFAULT_SETTINGS) => void
    mock.put.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = store.update({ textSize: 'large' })
    expect(store.saving).toBe(true)
    expect(store.settings.textSize).toBe('large')
    expect(readCachedPrefs().textSize).toBe('large')
    finish({ ...DEFAULT_SETTINGS, textSize: 'large' })
    expect(await pending).toBe(true)
    expect(mock.put).toHaveBeenCalledWith('/settings', { textSize: 'large' }, expect.anything())
    expect(store.saving).toBe(false)
    expect(readCachedPrefs().textSize).toBe('large')
  })

  it('rolls back the preview and cache if saving fails', async () => {
    storage.set('theama.prefs', '{"textSize":"small"}')
    const store = useSettingsStore()
    mock.put.mockRejectedValueOnce(new Error('Could not save'))
    const pending = store.update({ textSize: 'extra-large' })
    expect(store.settings.textSize).toBe('extra-large')
    expect(await pending).toBe(false)
    expect(store.settings.textSize).toBe('small')
    expect(readCachedPrefs().textSize).toBe('small')
    expect(store.error).toBe('Could not save')
    expect(store.saving).toBe(false)
  })

  it('applies service loads and shared settings changes to the cached preference', async () => {
    const store = useSettingsStore()
    mock.get.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, textSize: 'large' })
    await store.load()
    expect(store.loaded).toBe(true)
    expect(store.settings.textSize).toBe('large')
    mock.listener!({ type: 'settings.changed', settings: { ...DEFAULT_SETTINGS, textSize: 'default' } })
    expect(store.settings.textSize).toBe('default')
    expect(readCachedPrefs().textSize).toBe('default')
  })
})
