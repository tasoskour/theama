import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTitles } from './useTitles'

const mock = vi.hoisted(() => ({ get: vi.fn(), event: null as null | ((e: { type: string }) => void) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ fullPath: '/movies' }), useRouter: () => ({}) }))
vi.mock('@/stores/connection', () => ({ useConnectionStore: () => connection }))
const connection = reactive({ phase: 'connected', client: { get: mock.get }, onEvent: (callback: typeof mock.event) => { mock.event = callback; return () => { mock.event = null } } })
const page = (key: string, cursor: string | null = null) => ({ items: [{ key }], total: 2, nextCursor: cursor })
let scope: EffectScope
const flush = async () => { await nextTick(); await Promise.resolve(); await nextTick() }
beforeEach(() => { vi.useFakeTimers(); mock.get.mockReset(); mock.get.mockResolvedValue(page('first', 'next')); scope = effectScope() })
afterEach(() => { scope.stop(); vi.clearAllTimers(); vi.useRealTimers() })

describe('paged title requests', () => {
  it('coalesces scan notifications and performs one trailing refresh during a pending request', async () => {
    scope.run(() => useTitles({ kind: () => 'movie' }))
    await flush()
    mock.event!({ type: 'scan.finished' }); mock.event!({ type: 'library.changed' })
    await vi.advanceTimersByTimeAsync(100)
    expect(mock.get).toHaveBeenCalledTimes(2)
    let finish!: (value: unknown) => void
    mock.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    mock.event!({ type: 'library.changed' })
    await vi.advanceTimersByTimeAsync(100)
    mock.event!({ type: 'library.changed' })
    await vi.advanceTimersByTimeAsync(100)
    expect(mock.get).toHaveBeenCalledTimes(3)
    finish(page('updated'))
    await flush()
    await vi.advanceTimersByTimeAsync(100)
    expect(mock.get).toHaveBeenCalledTimes(4)
  })

  it('aborts obsolete pagination immediately and ignores its late failure during a new search', async () => {
    const q = ref('')
    const list = scope.run(() => useTitles({ kind: () => 'movie', q }))!
    await flush()
    let rejectOld!: (reason: Error) => void
    mock.get.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
    const more = list.loadMore()
    const oldSignal = mock.get.mock.calls.at(-1)![3].signal as AbortSignal
    q.value = 'new'
    await flush()
    expect(oldSignal.aborted).toBe(true)
    let finish!: (value: unknown) => void
    mock.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(250)
    rejectOld(new Error('obsolete'))
    await more
    expect(list.error.value).toBeNull()
    expect(list.loading.value).toBe(true)
    finish(page('new'))
    await flush()
    expect(list.items.value[0]!.key).toBe('new')
    expect(list.loading.value).toBe(false)
  })

  it('cancels pending work and refresh timers when the view is disposed', async () => {
    scope.run(() => useTitles({ kind: () => 'movie' }))
    const signal = mock.get.mock.calls[0]![3].signal as AbortSignal
    mock.event!({ type: 'library.changed' })
    scope.stop()
    expect(signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(mock.get).toHaveBeenCalledOnce()
  })
})
