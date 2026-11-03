import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { advanceProgress, emptyProgress, readSetupProgress, SETUP_PROGRESS_KEY, writeSetupProgress } from './progress'
import { useSetupStore } from '@/stores/setup'

let values: Map<string, string>
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
beforeEach(() => { values = new Map(); setActivePinia(createPinia()); vi.stubGlobal('localStorage', storage) })
afterEach(() => vi.unstubAllGlobals())

describe('setup progress and first use', () => {
  it('keeps automatic setup disabled for fresh and existing profiles', () => {
    expect(readSetupProgress(storage).autoStart).toBe(false)
    values.set('theama.prefs', '{}')
    expect(readSetupProgress(storage).autoStart).toBe(false)
  })
  it('does not reopen an interrupted or dismissed wizard on launch', () => {
    const store = useSetupStore()
    store.start(); store.advance(); store.advance(true)
    expect(store.progress.step).toBe('library')
    expect(store.progress.skipped).toEqual(['service'])
    expect(readSetupProgress(storage)).toMatchObject({ autoStart: false, progress: { state: 'in_progress', step: 'library' } })
    store.dismiss()
    expect(store.resumable).toBe(true)
    expect(readSetupProgress(storage)).toMatchObject({ autoStart: false, progress: { state: 'dismissed' } })
    store.start()
    expect(store.progress.step).toBe('library')
  })
  it('allows skipping every configuration step, reviewing, and finishing', () => {
    const store = useSetupStore()
    store.start()
    for (let i = 0; i < 7; i++) store.advance(true)
    expect(store.progress.step).toBe('review')
    expect(store.progress.skipped).toEqual(['service', 'library', 'playback', 'metadata', 'subtitles', 'downloads'])
    store.complete()
    expect(store.resumable).toBe(false)
    expect(readSetupProgress(storage).autoStart).toBe(false)
  })
  it('clears a skip on a later successful visit and bounds back navigation', () => {
    let state = { ...emptyProgress(), step: 'metadata' as const, skipped: ['metadata' as const] }
    expect(advanceProgress(state, false).skipped).toEqual([])
    const store = useSetupStore()
    store.back()
    expect(store.progress.step).toBe('welcome')
    state = { ...state, skipped: [] }
    expect(advanceProgress(state, true).skipped).toEqual(['metadata'])
  })
  it('restart only changes wizard state and persists no provider secrets', () => {
    values.set('theama.prefs', '{"language":"el"}')
    const store = useSetupStore()
    store.start(); store.chooseLanguage('el'); store.jump('downloads'); store.complete(); store.start(true)
    expect(store.progress).toEqual({ ...emptyProgress(), state: 'in_progress' })
    expect(values.get('theama.prefs')).toBe('{"language":"el"}')
    expect(JSON.parse(values.get(SETUP_PROGRESS_KEY)!)).toEqual({ version: 1, state: 'in_progress', step: 'welcome', skipped: [] })
  })
  it.each(['broken', 'null', '[]', '{"version":2}', '{"version":1,"state":"new","step":"bad","skipped":[]}'])('recovers from invalid storage without rerouting: %s', (raw) => {
    values.set(SETUP_PROGRESS_KEY, raw)
    expect(readSetupProgress(storage)).toMatchObject({ autoStart: false, progress: emptyProgress() })
  })
  it('remains usable when reading or writing profile storage throws', () => {
    const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    expect(readSetupProgress(blocked)).toMatchObject({ storageAvailable: false, autoStart: false })
    expect(writeSetupProgress(blocked, emptyProgress())).toBe(false)
    vi.stubGlobal('localStorage', blocked)
    const store = useSetupStore()
    store.start(); store.advance(); store.dismiss()
    expect(store.progress.step).toBe('service')
    expect(store.storageAvailable).toBe(false)
  })
})
