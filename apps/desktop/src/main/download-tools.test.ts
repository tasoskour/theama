import { describe, expect, it, vi } from 'vitest'
import { DownloadToolsManager, localVpnState, parseInsights, prowlarrAddress, toolLocations, type DownloadToolsOptions, type NetworkSnapshot } from './download-tools'

function network(overrides: Partial<NetworkSnapshot> = {}): NetworkSnapshot {
  return {
    processes: ['NordVPNApp', 'qbittorrent'],
    adapters: [{ index: 22, name: 'NordLynx', description: 'NordLynx Tunnel', up: true }],
    addresses: [{ index: 22, address: '10.5.0.2' }], internetRoutes: [22, 22], ipv6Routes: [], ...overrides,
  }
}
function setup(overrides: Partial<DownloadToolsOptions> = {}) {
  const snapshot = vi.fn(async () => network())
  const protection = vi.fn(async () => ({ protected: true, location: { country: 'Germany', countryCode: 'DE', city: 'Frankfurt' } }))
  const launch = vi.fn(async (_path: string) => undefined)
  const openBrowser = vi.fn(async () => undefined)
  const ready = vi.fn(async () => true)
  const manager = new DownloadToolsManager({ platform: 'win32', snapshot, protection, launch, openBrowser, ready,
    prowlarrUrl: async () => null, exists: () => true, sleep: async () => undefined, now: () => 12345, ...overrides })
  return { manager, snapshot, protection, launch, openBrowser, ready }
}

describe('NordVPN connection evidence', () => {
  it('verifies an active, routed tunnel only after the online check and a second local check', async () => {
    const { manager, protection, snapshot } = setup()
    const status = await manager.status()
    expect(status.vpn).toEqual({ state: 'connected', reason: 'verified', checkedAt: 12345, location: { country: 'Germany', countryCode: 'DE', city: 'Frankfurt' } })
    expect(protection).toHaveBeenCalledOnce()
    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(status.tools.qbittorrent.running).toBe(true) // No Web UI requests are used.
  })

  it('never treats an open NordVPN app or service as a connection', async () => {
    const protection = vi.fn(async () => ({ protected: false, location: null }))
    const { manager } = setup({ protection, snapshot: async () => network({
      processes: ['NordVPNApp', 'nordvpn-service', 'qbittorrent'],
      adapters: [{ index: 22, name: 'NordLynx', description: 'NordLynx Tunnel', up: false }],
    }) })
    const status = await manager.status()
    expect(status.tools.nordvpn.running).toBe(true)
    expect(status.vpn.state).toBe('disconnected')
    expect(protection).toHaveBeenCalledOnce()
  })

  it('reports an unverifiable protocol when public protection exists without a supported active tunnel', async () => {
    const { manager } = setup({ snapshot: async () => network({
      adapters: [{ index: 22, name: 'NordLynx', description: 'NordLynx Tunnel', up: false }],
    }) })
    expect((await manager.status()).vpn).toMatchObject({ state: 'unknown', reason: 'unsupported_tunnel' })
  })

  it.each(['TAP-NordVPN Windows Adapter V9', 'OpenVPN Data Channel Offload for NordVPN'])('recognizes %s', (description) => {
    expect(localVpnState(network({ adapters: [{ index: 22, name: 'Local Area Connection', description, up: true }] })).reason).toBe('protection_failed')
  })

  it('ignores unrelated virtual adapters and unsupported tunnels', () => {
    expect(localVpnState(network({ adapters: [{ index: 22, name: 'vEthernet (WSL)', description: 'Hyper-V Virtual Ethernet Adapter', up: true }] }))).toEqual({ state: 'unknown', reason: 'unsupported_tunnel' })
  })

  it.each(['0.0.0.0', '127.0.0.1', '169.254.1.1', 'invalid'])('rejects unusable tunnel address %s', (address) => {
    expect(localVpnState(network({ addresses: [{ index: 22, address }] })).state).toBe('disconnected')
  })

  it('requires both internet routes and rejects an active IPv6 bypass', () => {
    expect(localVpnState(network({ internetRoutes: [22, 14] })).reason).toBe('route_mismatch')
    expect(localVpnState(network({ internetRoutes: [] })).reason).toBe('route_mismatch')
    expect(localVpnState(network({ ipv6Routes: [14], adapters: [...network().adapters, { index: 14, name: 'Ethernet', description: 'Ethernet', up: true }] })).reason).toBe('route_mismatch')
  })

  it('does not verify a tunnel that dropped during the online check', async () => {
    const { manager, snapshot } = setup()
    snapshot.mockResolvedValueOnce(network()).mockResolvedValueOnce(network({ internetRoutes: [14, 14] }))
    expect((await manager.status()).vpn.state).toBe('unknown')
  })

  it('does not verify an unprotected public connection', async () => {
    const { manager } = setup({ protection: async () => ({ protected: false, location: null }) })
    expect((await manager.status()).vpn).toMatchObject({ state: 'unknown', reason: 'protection_failed' })
  })

  it('handles protection timeouts and invalid online responses conservatively', async () => {
    const { manager } = setup({ protection: async () => { throw new Error('Timeout or malformed response') } })
    expect((await manager.status()).vpn).toMatchObject({ state: 'unknown', reason: 'check_failed' })
  })

  it('validates the actual HTTPS response instead of accepting a truthy value', async () => {
    const http = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ protected: 'true' })))
    try {
      const { manager } = setup({ protection: undefined })
      expect((await manager.status()).vpn.state).toBe('unknown')
      expect(http.mock.calls[0]?.[0]).toBe('https://api.nordvpn.com/v1/helpers/ips/insights')
    } finally { http.mockRestore() }
  })

  it('never reports a place unless the connection is verified', async () => {
    const dropped = setup()
    dropped.snapshot.mockResolvedValueOnce(network()).mockResolvedValueOnce(network({ internetRoutes: [14, 14] }))
    expect((await dropped.manager.status()).vpn.location).toBeUndefined()
    const unprotected = setup({ protection: async () => ({ protected: false, location: { country: 'Germany', countryCode: 'DE', city: null } }) })
    expect((await unprotected.manager.status()).vpn.location).toBeUndefined()
  })

  it('reads the place from the insights response and tolerates a missing one', () => {
    expect(parseInsights({ protected: true, country: 'Germany', country_code: 'de', city: 'Frankfurt' }))
      .toEqual({ protected: true, location: { country: 'Germany', countryCode: 'DE', city: 'Frankfurt' } })
    expect(parseInsights({ protected: true })).toEqual({ protected: true, location: null })
    expect(parseInsights({ protected: true, country: 'Germany', city: '' }).location).toEqual({ country: 'Germany', countryCode: null, city: null })
  })

  it('reports unknown process state if Windows probing fails', async () => {
    const { manager } = setup({ snapshot: async () => { throw new Error('PowerShell failed') } })
    const result = await manager.status()
    expect(result.vpn.state).toBe('unknown')
    expect(result.tools.qbittorrent.running).toBeNull()
  })

  it('coalesces concurrent connection checks', async () => {
    const { manager, protection } = setup()
    const a = manager.status()
    const b = manager.status()
    expect(a).toBe(b)
    await Promise.all([a, b])
    expect(protection).toHaveBeenCalledOnce()
  })

  it('returns unsupported on other platforms without invoking Windows', async () => {
    const { manager, snapshot } = setup({ platform: 'linux' })
    expect((await manager.status()).vpn.state).toBe('unsupported')
    expect(await manager.open('qbittorrent')).toEqual({ ok: false, code: 'unavailable' })
    expect(snapshot).not.toHaveBeenCalled()
  })
})

describe('opening download apps', () => {
  it('discovers the installed Windows paths', () => {
    expect(toolLocations('nordvpn', { ProgramFiles: 'D:\\Apps' })).toContain('D:\\Apps\\NordVPN\\NordVPN.exe')
    expect(toolLocations('qbittorrent', {})).toContain('C:\\Program Files\\qBittorrent\\qbittorrent.exe')
    expect(toolLocations('prowlarr', {})).toContain('C:\\ProgramData\\Prowlarr\\bin\\Prowlarr.exe')
  })

  it('starts qBittorrent while the VPN is disconnected and holds duplicate clicks', async () => {
    const { manager, snapshot, launch, protection } = setup()
    snapshot.mockResolvedValueOnce(network({ processes: [], internetRoutes: [] }))
    const a = manager.open('qbittorrent')
    const b = manager.open('qbittorrent')
    expect(a).toBe(b)
    expect(await a).toEqual({ ok: true, code: null })
    expect(launch).toHaveBeenCalledOnce()
    expect(launch.mock.calls[0]?.[0]).toMatch(/qBittorrent\\qbittorrent.exe$/)
    expect(protection).not.toHaveBeenCalled()
  })

  it('reports a missing installation', async () => {
    const { manager, launch } = setup({ exists: () => false })
    expect(await manager.open('nordvpn')).toEqual({ ok: false, code: 'not_installed' })
    expect(launch).not.toHaveBeenCalled()
  })

  it('reports launch errors', async () => {
    const { manager } = setup({ launch: async () => { throw new Error('ENOENT') } })
    expect(await manager.open('qbittorrent')).toEqual({ ok: false, code: 'launch_failed' })
  })

  it('opens the configured Prowlarr address after starting and waiting for readiness', async () => {
    const { manager, launch, ready, openBrowser } = setup({ prowlarrUrl: async () => 'http://localhost:9898/prowlarr/' })
    ready.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await manager.open('prowlarr')).toEqual({ ok: true, code: null })
    expect(launch).toHaveBeenCalledOnce()
    expect(ready).toHaveBeenCalledTimes(2)
    expect(openBrowser).toHaveBeenCalledExactlyOnceWith('http://localhost:9898/prowlarr/')
  })

  it('does not start a second Prowlarr process if it is already running', async () => {
    const { manager, launch, openBrowser } = setup({ snapshot: async () => network({ processes: ['Prowlarr'] }) })
    expect((await manager.open('prowlarr')).ok).toBe(true)
    expect(launch).not.toHaveBeenCalled()
    expect(openBrowser).toHaveBeenCalledExactlyOnceWith('http://localhost:9696/')
  })

  it('does not open a browser before Prowlarr becomes ready', async () => {
    const { manager, openBrowser } = setup({ ready: async () => false })
    expect(await manager.open('prowlarr')).toEqual({ ok: false, code: 'not_ready' })
    expect(openBrowser).not.toHaveBeenCalled()
  })

  it('opens remote Prowlarr without launching a local instance', async () => {
    const { manager, launch, ready, openBrowser } = setup({ prowlarrUrl: async () => 'https://nas.example/prowlarr' })
    expect((await manager.open('prowlarr')).ok).toBe(true)
    expect(launch).not.toHaveBeenCalled()
    expect(ready).not.toHaveBeenCalled()
    expect(openBrowser).toHaveBeenCalledWith('https://nas.example/prowlarr')
  })

  it.each(['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'http://user:password@localhost:9696'])('rejects unsafe address %s', async (url) => {
    expect(prowlarrAddress(url)).toBeNull()
    const { manager, launch, openBrowser } = setup({ prowlarrUrl: async () => url })
    expect(await manager.open('prowlarr')).toEqual({ ok: false, code: 'invalid_address' })
    expect(launch).not.toHaveBeenCalled()
    expect(openBrowser).not.toHaveBeenCalled()
  })
})
