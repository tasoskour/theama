import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextUpOffer, PlayResult } from '@theama/contracts'
import { useNextUpStore } from './nextUp'
import { useTitleActionsStore } from './titleActions'

const bridge = vi.hoisted(() => ({
  playNext: vi.fn(async (): Promise<PlayResult> => ({ ok: true, code: null, message: null, playerName: 'MPC-HC' })),
  cancelNext: vi.fn(async () => undefined),
  onNextUp: vi.fn(() => () => undefined),
  onNextUpCancelled: vi.fn((_listener: (offerId: string) => void) => () => undefined),
}))
vi.mock('@/api/bridge', () => ({ getBridge: () => ({ players: bridge }) }))

const nextUp: NextUpOffer = {
  offerId: '52af5bee-ae61-4cbd-9be7-12ba539ae4bc',
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
    expect(bridge.playNext).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(11000)
    expect(store.open).toBe(false)
    expect(bridge.playNext).toHaveBeenCalledExactlyOnceWith(nextUp.offerId)
  })

  it('Cancel prevents the next episode from starting after the countdown', async () => {
    const store = useNextUpStore()
    store.show(nextUp)
    await vi.advanceTimersByTimeAsync(4000)
    store.cancel()
    await vi.advanceTimersByTimeAsync(10000)
    expect(store.open).toBe(false)
    expect(bridge.playNext).not.toHaveBeenCalled()
    expect(bridge.cancelNext).toHaveBeenCalledExactlyOnceWith(nextUp.offerId)
  })

  it('Play now cancels the timer and cannot launch a second copy', async () => {
    const store = useNextUpStore()
    store.show(nextUp)
    await store.playNow()
    await store.playNow()
    await vi.advanceTimersByTimeAsync(10000)
    expect(bridge.playNext).toHaveBeenCalledOnce()
    expect(store.open).toBe(false)
  })

  it('honors immediate playback and a changed countdown', async () => {
    const store = useNextUpStore()
    store.show({ ...nextUp, countdownSeconds: 0 })
    expect(bridge.playNext).toHaveBeenCalledOnce()
    store.show({ ...nextUp, offerId: 'second-offer', countdownSeconds: 12 })
    await vi.advanceTimersByTimeAsync(11000)
    expect(bridge.playNext).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(bridge.playNext).toHaveBeenCalledTimes(2)
  })

  it('replaces an existing countdown and reports launch failures without retrying playback', async () => {
    const store = useNextUpStore()
    store.show(nextUp)
    await vi.advanceTimersByTimeAsync(3000)
    bridge.playNext.mockResolvedValueOnce({ ok: false, code: 'launch_failed', message: 'Player unavailable', playerName: 'MPC-HC' })
    store.show({ ...nextUp, offerId: 'replacement-offer', next: { ...nextUp.next, fileId: 3 } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(bridge.playNext).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10000)
    expect(bridge.playNext).toHaveBeenCalledExactlyOnceWith('replacement-offer')
    expect(bridge.cancelNext).toHaveBeenCalledWith(nextUp.offerId)
    expect(useTitleActionsStore().message).toBe('Player unavailable')
    expect(store.open).toBe(false)
  })

  it('ignores duplicate offers before and after they have been consumed', async () => {
    const store = useNextUpStore()
    store.show(nextUp)
    await vi.advanceTimersByTimeAsync(4000)
    store.show(nextUp)
    await vi.advanceTimersByTimeAsync(1000)
    store.show(nextUp)
    await vi.advanceTimersByTimeAsync(10000)
    expect(bridge.playNext).toHaveBeenCalledOnce()
    expect(store.open).toBe(false)
  })

  it('dismisses only the matching countdown when the desktop invalidates an offer', async () => {
    const store = useNextUpStore()
    store.show(nextUp)
    const cancel = bridge.onNextUpCancelled.mock.calls[0]![0]
    cancel('old-offer')
    expect(store.open).toBe(true)
    cancel(nextUp.offerId)
    await vi.advanceTimersByTimeAsync(10000)
    expect(store.open).toBe(false)
    expect(bridge.playNext).not.toHaveBeenCalled()
    expect(bridge.cancelNext).not.toHaveBeenCalled()
  })

  it('reports an IPC failure and does not retry', async () => {
    bridge.playNext.mockRejectedValueOnce(new Error('Disconnected'))
    const store = useNextUpStore()
    store.show(nextUp)
    await vi.advanceTimersByTimeAsync(10000)
    expect(useTitleActionsStore().message).toBe('Disconnected')
    expect(bridge.playNext).toHaveBeenCalledOnce()
  })
})
