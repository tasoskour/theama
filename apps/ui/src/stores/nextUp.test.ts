import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextUp, PlayResult } from '@theama/contracts'
import { useNextUpStore } from './nextUp'
import { useTitleActionsStore } from './titleActions'

const bridge = vi.hoisted(() => ({
  play: vi.fn(async (): Promise<PlayResult> => ({ ok: true, code: null, message: null, playerName: 'MPC-HC' })),
  onNextUp: vi.fn(() => () => undefined),
}))
vi.mock('@/api/bridge', () => ({ getBridge: () => ({ players: bridge }) }))

const nextUp: NextUp = {
  next: { fileId: 2, season: 1, episode: 2, label: 'S01E02', resumeSeconds: null },
  title: 'Show', countdownSeconds: 5,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('next episode countdown', () => {
  it('shows the episode and starts it exactly once when the countdown finishes', async () => {
    const store = useNextUpStore()
    expect(bridge.onNextUp).toHaveBeenCalledOnce()
    store.show(nextUp)
    expect(store.open).toBe(true)
    expect(store.remaining).toBe(5)
    await vi.advanceTimersByTimeAsync(4000)
    expect(store.remaining).toBe(1)
    expect(bridge.play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(11000)
    expect(store.open).toBe(false)
    expect(bridge.play).toHaveBeenCalledExactlyOnceWith({ fileId: 2, playerId: undefined })
  })

  it('Cancel prevents the next episode from starting after the countdown', async () => {
    const store = useNextUpStore()
    store.show(nextUp)
    await vi.advanceTimersByTimeAsync(4000)
    store.cancel()
    await vi.advanceTimersByTimeAsync(10000)
    expect(store.open).toBe(false)
    expect(bridge.play).not.toHaveBeenCalled()
  })

  it('Play now cancels the timer and cannot launch a second copy', async () => {
    const store = useNextUpStore()
    store.show(nextUp)
    await store.playNow()
    await store.playNow()
    await vi.advanceTimersByTimeAsync(10000)
    expect(bridge.play).toHaveBeenCalledOnce()
    expect(store.open).toBe(false)
  })

  it('honors immediate playback and a changed countdown', async () => {
    const store = useNextUpStore()
    store.show({ ...nextUp, countdownSeconds: 0 })
    expect(bridge.play).toHaveBeenCalledOnce()
    store.show({ ...nextUp, countdownSeconds: 12 })
    await vi.advanceTimersByTimeAsync(11000)
    expect(bridge.play).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(bridge.play).toHaveBeenCalledTimes(2)
  })

  it('replaces an existing countdown and reports launch failures without retrying playback', async () => {
    const store = useNextUpStore()
    store.show(nextUp)
    await vi.advanceTimersByTimeAsync(3000)
    bridge.play.mockResolvedValueOnce({ ok: false, code: 'launch_failed', message: 'Player unavailable', playerName: 'MPC-HC' })
    store.show({ ...nextUp, next: { ...nextUp.next, fileId: 3 } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(bridge.play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10000)
    expect(bridge.play).toHaveBeenCalledExactlyOnceWith({ fileId: 3, playerId: undefined })
    expect(useTitleActionsStore().message).toBe('Player unavailable')
    expect(store.open).toBe(false)
  })
})
