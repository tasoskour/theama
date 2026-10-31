import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import { win32 } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { DownloadTool, type DownloadToolsStatus, type OpenDownloadToolResult, type VpnLocation } from '@theama/contracts'

const execFileAsync = promisify(execFile)
const PROTECTION_URL = 'https://api.nordvpn.com/v1/helpers/ips/insights'
const ToolList = DownloadTool.options

const Insights = z.object({
  protected: z.boolean(),
  country: z.string().optional(),
  country_code: z.string().length(2).optional(),
  city: z.string().optional(),
})
export type Protection = { protected: boolean; location: VpnLocation | null }

export function parseInsights(body: unknown): Protection {
  const insights = Insights.parse(body)
  // The place is only ever shown for a verified connection; a partial answer just means no place.
  const location = insights.country ? { country: insights.country, countryCode: insights.country_code?.toUpperCase() ?? null, city: insights.city || null } : null
  return { protected: insights.protected, location }
}

const Snapshot = z.object({
  processes: z.array(z.string()),
  adapters: z.array(z.object({ index: z.number(), name: z.string(), description: z.string(), up: z.boolean() })),
  addresses: z.array(z.object({ index: z.number(), address: z.string() })),
  internetRoutes: z.array(z.number()),
  ipv6Routes: z.array(z.number()),
})
export type NetworkSnapshot = z.infer<typeof Snapshot>

// Static commands only. A process being present is deliberately separate from VPN connectivity.
const PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$adapters = @(Get-NetAdapter | ForEach-Object { @{ index = [int]$_.ifIndex; name = $_.Name; description = $_.InterfaceDescription; up = ($_.Status -eq 'Up') } })
$addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' } | ForEach-Object { @{ index = [int]$_.InterfaceIndex; address = $_.IPAddress } })
$routes = @(foreach ($target in @('1.1.1.1', '129.1.1.1')) { Find-NetRoute -RemoteIPAddress $target -ErrorAction SilentlyContinue | Where-Object { $null -ne $_.DestinationPrefix } | ForEach-Object { [int]$_.InterfaceIndex } })
$ipv6 = @(Get-NetRoute -AddressFamily IPv6 -DestinationPrefix '::/0' -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.InterfaceIndex })
$processes = @(Get-Process | ForEach-Object { $_.ProcessName })
@{ adapters = $adapters; addresses = $addresses; internetRoutes = $routes; ipv6Routes = $ipv6; processes = $processes } | ConvertTo-Json -Depth 4 -Compress
`

export async function readNetworkSnapshot(): Promise<NetworkSnapshot> {
  const powershell = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const { stdout } = await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT], {
    windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'utf8',
  })
  return Snapshot.parse(JSON.parse(stdout.replace(/^\uFEFF/, '').trim()))
}

function nordAdapter(adapter: NetworkSnapshot['adapters'][number]): boolean {
  return /nordlynx|tap-nordvpn|openvpn.*nordvpn|nordvpn.*openvpn/i.test(`${adapter.name} ${adapter.description}`)
}

function usableAddress(address: string): boolean {
  return isIP(address) === 4 && !/^(0\.|127\.|169\.254\.)/.test(address)
}

export function localVpnState(snapshot: NetworkSnapshot): Pick<DownloadToolsStatus['vpn'], 'state' | 'reason'> {
  const known = snapshot.adapters.filter(nordAdapter)
  if (!known.length) return { state: 'unknown', reason: 'unsupported_tunnel' }
  const active = known.filter((a) => a.up && snapshot.addresses.some((ip) => ip.index === a.index && usableAddress(ip.address)))
  if (!active.length) return { state: 'disconnected', reason: 'no_tunnel' }
  const indices = new Set(active.map((a) => a.index))
  const up = new Set(snapshot.adapters.filter((a) => a.up).map((a) => a.index))
  if (snapshot.internetRoutes.length !== 2 || snapshot.internetRoutes.some((index) => !indices.has(index)) || snapshot.ipv6Routes.some((index) => up.has(index) && !indices.has(index))) {
    return { state: 'unknown', reason: 'route_mismatch' }
  }
  // A working route alone does not prove a working connection. The HTTPS check is still required.
  return { state: 'unknown', reason: 'protection_failed' }
}

export function toolLocations(tool: DownloadTool, env: NodeJS.ProcessEnv): string[] {
  const programDirs = [...new Set([env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files'].filter((p): p is string => !!p))]
  if (tool === 'nordvpn') return programDirs.map((p) => win32.join(p, 'NordVPN', 'NordVPN.exe'))
  if (tool === 'qbittorrent') return programDirs.map((p) => win32.join(p, 'qBittorrent', 'qbittorrent.exe'))
  return [win32.join(env.ProgramData ?? 'C:\\ProgramData', 'Prowlarr', 'bin', 'Prowlarr.exe'),
    ...programDirs.flatMap((p) => [win32.join(p, 'Prowlarr', 'bin', 'Prowlarr.exe'), win32.join(p, 'Prowlarr', 'Prowlarr.exe')]),
    ...(env.LOCALAPPDATA ? [win32.join(env.LOCALAPPDATA, 'Prowlarr', 'bin', 'Prowlarr.exe')] : [])]
}

function isRunning(tool: DownloadTool, snapshot: NetworkSnapshot): boolean {
  const names = tool === 'nordvpn' ? ['nordvpn', 'nordvpnapp'] : tool === 'prowlarr' ? ['prowlarr', 'prowlarr.console'] : ['qbittorrent']
  return snapshot.processes.some((p) => names.includes(p.toLowerCase()))
}

export function launchTool(exe: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // These apps have visible windows, opened at the person's explicit request.
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', shell: false, windowsHide: false })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

export function prowlarrAddress(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch { return null }
}

export interface DownloadToolsOptions {
  openBrowser(url: string): Promise<void>
  /** Read from the authenticated backend, never from a renderer-supplied URL. */
  prowlarrUrl(): Promise<string | null>
  platform?: string
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
  snapshot?: () => Promise<NetworkSnapshot>
  protection?: () => Promise<Protection>
  launch?: (path: string) => Promise<void>
  ready?: (url: string) => Promise<boolean>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export class DownloadToolsManager {
  private checking: Promise<DownloadToolsStatus> | null = null
  private readonly opening = new Map<DownloadTool, Promise<OpenDownloadToolResult>>()
  private readonly snapshot: () => Promise<NetworkSnapshot>
  private readonly now: () => number

  constructor(private readonly options: DownloadToolsOptions) {
    this.snapshot = options.snapshot ?? readNetworkSnapshot
    this.now = options.now ?? Date.now
  }

  private get supported(): boolean { return (this.options.platform ?? process.platform) === 'win32' }

  private executable(tool: DownloadTool): string | null {
    return toolLocations(tool, this.options.env ?? process.env).find(this.options.exists ?? existsSync) ?? null
  }

  status(): Promise<DownloadToolsStatus> {
    if (this.checking) return this.checking
    this.checking = this.checkStatus().finally(() => { this.checking = null })
    return this.checking
  }

  private async checkStatus(): Promise<DownloadToolsStatus> {
    let snapshot: NetworkSnapshot | null = null
    let vpn: DownloadToolsStatus['vpn'] = { state: 'unsupported', reason: 'unsupported_platform', checkedAt: this.now() }
    if (this.supported) {
      try {
        snapshot = await this.snapshot()
        vpn = { ...localVpnState(snapshot), checkedAt: this.now() }
        if (vpn.reason === 'protection_failed' || vpn.reason === 'no_tunnel') {
          const protectedConnection = await (this.options.protection ?? (async () => {
            const res = await fetch(PROTECTION_URL, { signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store' })
            if (!res.ok) throw new Error('Protection check failed')
            return parseInsights(await res.json())
          }))()
          if (protectedConnection.protected) {
            if (vpn.reason === 'no_tunnel') {
              // A protected public connection without a supported local tunnel may be
              // NordWhisper, a router VPN, or another protocol we cannot inspect.
              vpn = { state: 'unknown', reason: 'unsupported_tunnel', checkedAt: this.now() }
            } else {
              // Do not publish a green result if the tunnel dropped during the HTTPS request.
              snapshot = await this.snapshot()
              if (localVpnState(snapshot).reason === 'protection_failed') vpn = { state: 'connected', reason: 'verified', checkedAt: this.now(), location: protectedConnection.location }
              else vpn = { state: 'unknown', reason: 'route_mismatch', checkedAt: this.now() }
            }
          }
        }
      } catch { vpn = { state: 'unknown', reason: 'check_failed', checkedAt: this.now() } }
    }
    return {
      vpn: { ...vpn, checkedAt: this.now() },
      tools: Object.fromEntries(ToolList.map((tool) => [tool, {
        installed: this.supported && this.executable(tool) !== null,
        running: snapshot ? isRunning(tool, snapshot) : null,
      }])) as DownloadToolsStatus['tools'],
    }
  }

  open(tool: DownloadTool): Promise<OpenDownloadToolResult> {
    const pending = this.opening.get(tool)
    if (pending) return pending
    const action = this.openTool(tool).finally(() => this.opening.delete(tool))
    this.opening.set(tool, action)
    return action
  }

  private async openTool(tool: DownloadTool): Promise<OpenDownloadToolResult> {
    if (!this.supported) return { ok: false, code: 'unavailable' }
    try {
      const snapshot = await this.snapshot()
      let address: string | null = null
      if (tool === 'prowlarr') {
        address = prowlarrAddress((await this.options.prowlarrUrl()) ?? 'http://localhost:9696')
        if (!address) return { ok: false, code: 'invalid_address' }
        const hostname = new URL(address).hostname
        if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
          await this.options.openBrowser(address)
          return { ok: true, code: null }
        }
      }
      if (tool !== 'prowlarr' || !isRunning(tool, snapshot)) {
        const exe = this.executable(tool)
        if (!exe) return { ok: false, code: 'not_installed' }
        await (this.options.launch ?? launchTool)(exe)
      }
      // Hold the launch lock until the process (and Prowlarr's UI) is ready.
      const ready = this.options.ready ?? (async (url: string) => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'manual' })
          await res.body?.cancel()
          return res.ok || [301, 302, 303, 307, 308, 401, 403].includes(res.status)
        } catch { return false }
      })
      for (let attempt = 0; attempt < 12; attempt++) {
        if (address ? await ready(address) : isRunning(tool, await this.snapshot())) {
          if (address) await this.options.openBrowser(address)
          return { ok: true, code: null }
        }
        await (this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(500)
      }
      return { ok: false, code: 'not_ready' }
    } catch { return { ok: false, code: 'launch_failed' } }
  }
}
