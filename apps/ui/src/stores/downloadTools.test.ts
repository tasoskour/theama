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
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('download tools polling', () => {
  it('pauses while hidden and refreshes immediately on return', async () => {
    const document = Object.assign(new EventTarget(), { hidden: false })
    vi.stubGlobal('document', document)
    const store = useDownloadToolsStore()
    store.start()
    await store.refresh()
    document.hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(bridge.status).toHaveBeenCalledOnce()
    document.hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await store.refresh()
    expect(bridge.status).toHaveBeenCalledTimes(2)
    store.stop()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(bridge.status).toHaveBeenCalledTimes(2)
  })
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
    // The check that hangs starts on the next ten second tick; it expires VPN_STALE_MS after that.
    await vi.advanceTimersByTimeAsync(10_000 + VPN_STALE_MS)
    expect(store.vpnState).toBe('unknown')
    expect(store.vpnReason).toBe('stale')
    expect(store.qbRunning).toBeNull()
    expect(bridge.status).toHaveBeenCalledTimes(2)
    finish(verified())
    await store.refresh()
    expect(store.vpnState).toBe('connected')
    store.stop()
  })

  it('keeps the last result after one failed check and clears it after a repeat', async () => {
    const store = useDownloadToolsStore()
    await store.refresh()
    bridge.status.mockRejectedValueOnce(new Error('IPC unavailable'))
    await store.refresh()
    expect(store.vpnState).toBe('connected')
    bridge.status.mockRejectedValueOnce(new Error('IPC unavailable'))
    await store.refresh()
    expect(store.vpnState).toBe('unknown')
    expect(store.vpnReason).toBe('check_failed')
    expect(store.qbRunning).toBeNull()
  })

  it('shows the loader only before the first result and not for later background checks', async () => {
    const store = useDownloadToolsStore()
    expect(store.initializing).toBe(true)
    store.start()
    await store.refresh()
    expect(store.initializing).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(bridge.status).toHaveBeenCalledTimes(2)
    expect(store.initializing).toBe(false)
    expect(store.manualChecking).toBe(false)
    store.stop()
  })

  it('keeps showing the last verified result while returning to the screen re-checks', async () => {
    const store = useDownloadToolsStore()
    store.start()
    await store.refresh()
    store.stop()
    await vi.advanceTimersByTimeAsync(VPN_STALE_MS * 4)
    let finish!: (value: DownloadToolsStatus) => void
    bridge.status.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    store.start()
    expect(store.checking).toBe(true)
    expect(store.vpnState).toBe('connected')
    expect(store.initializing).toBe(false)
    finish({ ...verified(), vpn: { state: 'disconnected', reason: 'no_tunnel', checkedAt: Date.now() } })
    await store.refresh()
    expect(store.vpnState).toBe('disconnected')
    store.stop()
  })

  it('does not replace the result when a poll finds nothing new', async () => {
    const store = useDownloadToolsStore()
    await store.refresh()
    const first = store.status
    await vi.advanceTimersByTimeAsync(5)
    await store.refresh()
    expect(store.status).toBe(first)
  })

  it('spins the refresh button only for a manual check and exposes the place when verified', async () => {
    const store = useDownloadToolsStore()
    const place = { country: 'Germany', countryCode: 'DE', city: 'Frankfurt' }
    bridge.status.mockImplementation(async () => ({ ...verified(), vpn: { ...verified().vpn, location: place } }))
    const action = store.recheck()
    expect(store.manualChecking).toBe(true)
    await action
    expect(store.manualChecking).toBe(false)
    expect(store.vpnLocation).toEqual(place)
    bridge.status.mockImplementation(async () => ({ ...verified(), vpn: { state: 'disconnected', reason: 'no_tunnel', checkedAt: Date.now(), location: place } }))
    await store.refresh()
    expect(store.vpnLocation).toBeNull()
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

describe('asking to open a closed app', () => {
  it('opens the app on confirm and resolves every caller that asked about it', async () => {
    const store = useDownloadToolsStore()
    const first = store.ask('prowlarr')
    const second = store.ask('prowlarr')
    expect(store.prompt).toBe('prowlarr')
    await store.confirm()
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(bridge.open).toHaveBeenCalledExactlyOnceWith('prowlarr')
    expect(store.prompt).toBeNull()
  })

  it('stays open with the reason when the launch fails, and resolves false when dismissed', async () => {
    const store = useDownloadToolsStore()
    const answer = store.ask('qbittorrent')
    bridge.open.mockResolvedValueOnce({ ok: false, code: 'not_installed' })
    await store.confirm()
    expect(store.prompt).toBe('qbittorrent')
    expect(store.problem).toBe('not_installed')
    store.dismiss()
    expect(await answer).toBe(false)
    expect(store.prompt).toBeNull()
    expect(store.problem).toBeNull()
  })

  it('reports each app as running, closed or unknown', async () => {
    const store = useDownloadToolsStore()
    expect(store.running('prowlarr')).toBeNull()
    await store.refresh()
    expect(store.running('qbittorrent')).toBe(true)
    expect(store.running('prowlarr')).toBe(false)
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
