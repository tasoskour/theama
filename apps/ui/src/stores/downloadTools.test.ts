import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadToolsStatus, OpenDownloadToolResult } from '@theama/contracts'
import { isLocalDownloadAddress, useDownloadToolsStore, VPN_STALE_MS } from './downloadTools'

const bridge = vi.hoisted(() => ({ status: vi.fn<() => Promise<DownloadToolsStatus>>(), open: vi.fn<() => Promise<OpenDownloadToolResult>>() }))
vi.mock('@/api/bridge', () => ({ getBridge: () => ({ downloadTools: bridge }) }))

function verified(): DownloadToolsStatus {
  return { vpn: { state: 'connected', reason: 'verified', checkedAt: Date.now() }, tools: {
    nordvpn: { installed: true, running: true }, qbittorrent: { installed: true, running: true }, prowlarr: { installed: true, running: false },
  } }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  setActivePinia(createPinia())
  bridge.status.mockImplementation(async () => verified())
  bridge.open.mockResolvedValue({ ok: true, code: null })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('download tools polling', () => {
  it('refreshes immediately and every ten seconds, and stops when leaving the screen', async () => {
    const store = useDownloadToolsStore()
    store.start()
    await store.refresh()
    expect(bridge.status).toHaveBeenCalledOnce()
    expect(store.vpnState).toBe('connected')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(bridge.status).toHaveBeenCalledTimes(2)
    store.stop()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(bridge.status).toHaveBeenCalledTimes(2)
  })

  it('expires a previous green result while a check is stuck, without overlapping requests', async () => {
    const store = useDownloadToolsStore()
    store.start()
    await store.refresh()
    let finish!: (value: DownloadToolsStatus) => void
    bridge.status.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await vi.advanceTimersByTimeAsync(VPN_STALE_MS)
    expect(store.vpnState).toBe('unknown')
    expect(store.vpnReason).toBe('stale')
    expect(store.qbRunning).toBeNull()
    expect(bridge.status).toHaveBeenCalledTimes(2)
    finish(verified())
    await store.refresh()
    expect(store.vpnState).toBe('connected')
    store.stop()
  })

  it('clears verification on a failed check', async () => {
    const store = useDownloadToolsStore()
    await store.refresh()
    bridge.status.mockRejectedValueOnce(new Error('IPC unavailable'))
    await store.refresh()
    expect(store.vpnState).toBe('unknown')
    expect(store.vpnReason).toBe('check_failed')
    expect(store.qbRunning).toBeNull()
  })

  it('ignores results arriving after leaving and checks again on returning', async () => {
    const store = useDownloadToolsStore()
    let finish!: (value: DownloadToolsStatus) => void
    bridge.status.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    store.start()
    store.stop()
    store.start()
    finish({ ...verified(), vpn: { state: 'disconnected', reason: 'no_tunnel', checkedAt: Date.now() } })
    await vi.advanceTimersByTimeAsync(0)
    expect(bridge.status).toHaveBeenCalledTimes(2)
    expect(store.vpnState).toBe('connected')
    store.stop()
  })

  it('refreshes after an app launch, prevents duplicate clicks and exposes launch errors', async () => {
    const store = useDownloadToolsStore()
    store.start()
    await store.refresh()
    let finish!: (result: OpenDownloadToolResult) => void
    bridge.open.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const action = store.open('qbittorrent')
    expect(store.opening.qbittorrent).toBe(true)
    expect(await store.open('qbittorrent')).toBe(false)
    finish({ ok: false, code: 'not_installed' })
    expect(await action).toBe(false)
    expect(bridge.open).toHaveBeenCalledOnce()
    expect(bridge.status).toHaveBeenCalledTimes(2)
    expect(store.problem).toBe('not_installed')
    expect(store.opening.qbittorrent).toBe(false)
    store.stop()
  })

  it('takes a new process snapshot after launching even when a pre-launch check is pending', async () => {
    const store = useDownloadToolsStore()
    let finish!: (value: DownloadToolsStatus) => void
    bridge.status.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    store.start()
    const action = store.open('qbittorrent')
    const beforeLaunch = verified()
    beforeLaunch.tools.qbittorrent.running = false
    finish(beforeLaunch)
    await action
    expect(bridge.status).toHaveBeenCalledTimes(2)
    expect(store.qbRunning).toBe(true)
    store.stop()
  })
})

describe('qBittorrent host classification', () => {
  it.each(['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080', null])('accepts local address %s', (url) => {
    expect(isLocalDownloadAddress(url)).toBe(true)
  })
  it.each(['http://nas.local:8080', 'http://192.168.1.50:8080', 'invalid'])('requires separate verification for %s', (url) => {
    expect(isLocalDownloadAddress(url)).toBe(false)
  })
})
