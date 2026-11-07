import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@theama/contracts'
import { useAppUpdateStore } from './appUpdate'

const bridge = vi.hoisted(() => ({
  listener: undefined as ((s: UpdateState) => void) | undefined,
  initial: undefined as UpdateState | undefined,
  state: vi.fn(async () => bridge.initial as UpdateState),
  download: vi.fn(async (_when: 'now' | 'quit') => undefined),
  skip: vi.fn(async () => undefined),
  onState: vi.fn((l: (s: UpdateState) => void) => { bridge.listener = l; return () => undefined }),
}))
vi.mock('@/api/bridge', () => ({ getBridge: () => ({ updates: bridge }) }))

const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const base: UpdateState = { status: 'idle', version: null, percent: null, message: null, installWhenReady: false }
const available: UpdateState = { ...base, status: 'available', version: '1.5.0' }

beforeEach(() => {
  vi.clearAllMocks()
  bridge.initial = base
  setActivePinia(createPinia())
})

describe('app update prompt', () => {
  it('stays closed until a version is found, then opens', async () => {
    const store = useAppUpdateStore()
    await flushPromises()
    expect(store.open).toBe(false)
    bridge.listener?.(available)
    expect(store.open).toBe(true)
  })

  it('opens at once when the version was found before the window was listening', async () => {
    bridge.initial = available
    const store = useAppUpdateStore()
    await flushPromises()
    expect(store.open).toBe(true)
  })

  it('"update when I close" and "skip" call the bridge and the dialog closes as the state moves on', async () => {
    const store = useAppUpdateStore()
    bridge.listener?.(available)
    await store.updateOnClose()
    expect(bridge.download).toHaveBeenCalledWith('quit')
    bridge.listener?.({ ...available, status: 'downloading', percent: 3 })
    expect(store.open).toBe(false)

    bridge.listener?.(available)
    await store.skip()
    expect(bridge.skip).toHaveBeenCalledOnce()
    bridge.listener?.(base)
    expect(store.open).toBe(false)
  })

  it('"update now" keeps the dialog open to show progress', async () => {
    const store = useAppUpdateStore()
    bridge.listener?.(available)
    await store.updateNow()
    expect(bridge.download).toHaveBeenCalledWith('now')
    bridge.listener?.({ ...available, status: 'downloading', percent: 40, installWhenReady: true })
    expect(store.open).toBe(true)
  })

  it('shows a failed download, but not a failed start-up check', async () => {
    const store = useAppUpdateStore()
    bridge.listener?.({ ...base, status: 'error', message: 'offline' })
    expect(store.open).toBe(false)
    bridge.listener?.(available)
    await store.updateNow()
    bridge.listener?.({ ...base, status: 'error', message: 'offline' })
    expect(store.open).toBe(true)
    store.dismiss()
    expect(store.open).toBe(false)
  })
})
