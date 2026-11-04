import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSetupProgress, SETUP_PROGRESS_KEY } from './progress'
import { useSetupStore } from '@/stores/setup'

let values: Map<string, string>
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
beforeEach(() => { values = new Map(); setActivePinia(createPinia()); vi.stubGlobal('localStorage', storage) })
afterEach(() => vi.unstubAllGlobals())

describe('setup progress and first use', () => {
  it('opens setup once for a fresh profile only', () => {
    expect(readSetupProgress(storage).autoStart).toBe(true)
    values.set('theama.prefs', '{}')
    expect(readSetupProgress(storage).autoStart).toBe(false)
  })
  it('never reopens after the person has seen it', () => {
    const store = useSetupStore()
    store.start()
    expect(readSetupProgress(storage)).toMatchObject({ autoStart: false, progress: { state: 'in_progress' } })
    store.dismiss()
    expect(store.resumable).toBe(true)
    expect(readSetupProgress(storage)).toMatchObject({ autoStart: false, progress: { state: 'dismissed' } })
  })
  it('remembers skipped items and clears them when picked up again', () => {
    const store = useSetupStore()
    store.setSkipped('tmdb', true)
    store.setSkipped('subtitles', true)
    expect(store.progress.skipped).toEqual(['tmdb', 'subtitles'])
    store.setSkipped('tmdb', false)
    expect(readSetupProgress(storage).progress.skipped).toEqual(['subtitles'])
  })
  it('can be finished with everything skipped', () => {
    const store = useSetupStore()
    for (const item of ['tmdb', 'prowlarr', 'qbittorrent', 'subtitles'] as const) store.setSkipped(item, true)
    store.complete()
    expect(store.resumable).toBe(false)
    expect(readSetupProgress(storage).autoStart).toBe(false)
  })
  it('treats an old or invalid record as already seen', () => {
    values.set(SETUP_PROGRESS_KEY, '{"version":1,"state":"in_progress","step":"library","skipped":[]}')
    expect(readSetupProgress(storage)).toMatchObject({ autoStart: false, progress: { state: 'new', skipped: [] } })
  })
  it('persists no provider secrets', () => {
    const store = useSetupStore()
    store.start()
    expect(values.get(SETUP_PROGRESS_KEY)).toBe('{"version":2,"state":"in_progress","skipped":[]}')
  })
})
