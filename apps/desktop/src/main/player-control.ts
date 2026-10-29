import { connect } from 'node:net'
import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import type { LaunchOptions } from './players'
import { parseMpcVariables, type TrackingPlan } from './position-tracking'
import type { MpcBridge } from './mpc-bridge'

export async function playerWindowBounds(pid: number): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (process.platform !== 'win32') return null
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class TheamaPlayerBounds {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
}
'@
$player = Get-Process -Id ([int]$env:THEAMA_PLAYER_PID)
$rect = New-Object TheamaPlayerBounds+Rect
if ($player.MainWindowHandle -ne [IntPtr]::Zero -and [TheamaPlayerBounds]::GetWindowRect($player.MainWindowHandle, [ref]$rect)) {
  @{ x = $rect.left; y = $rect.top; width = $rect.right - $rect.left; height = $rect.bottom - $rect.top } | ConvertTo-Json -Compress
}
`
  const { stdout } = await promisify(execFile)(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 5000, env: { ...process.env, THEAMA_PLAYER_PID: String(pid) },
    })
  if (!stdout.trim()) return null
  const rect = JSON.parse(stdout) as { x: number; y: number; width: number; height: number }
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0 && rect.x > -30000 ? rect : null
}

/** Return focus to the reused video window after Theama's foreground countdown. */
export async function focusPlayer(pid: number): Promise<void> {
  if (process.platform !== 'win32') return
  const script = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class TheamaPlayerFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
}
'@
$player = Get-Process -Id ([int]$env:THEAMA_PLAYER_PID) -ErrorAction Stop
$window = $player.MainWindowHandle
if ($window -ne [IntPtr]::Zero) {
  if ([TheamaPlayerFocus]::IsIconic($window)) { [void][TheamaPlayerFocus]::ShowWindowAsync($window, 9) }
  [void][TheamaPlayerFocus]::SetForegroundWindow($window)
}
`
  await promisify(execFile)(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 5000, env: { ...process.env, THEAMA_PLAYER_PID: String(pid) },
    })
}

function vlcHeaders(plan: Extract<TrackingPlan, { kind: 'vlc' }>): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`:${plan.password}`).toString('base64')}` }
}

async function vlcRequest(plan: Extract<TrackingPlan, { kind: 'vlc' }>, query = new URLSearchParams()): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${plan.port}/requests/status.json?${query}`, {
    headers: vlcHeaders(plan), signal: AbortSignal.timeout(3000),
  })
  if (!res.ok) throw new Error(`VLC control: HTTP ${res.status}`)
  return res.json()
}

/** A separate request socket leaves the tracker's property subscriptions undisturbed. */
export function mpvCommand(plan: Extract<TrackingPlan, { kind: 'mpv' }>, command: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(plan.pipe)
    let buffer = ''
    const finish = (error?: Error, data?: unknown): void => {
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(data)
    }
    const timer = setTimeout(() => finish(new Error('mpv control timed out')), 3000)
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(`${JSON.stringify({ command, request_id: 1 })}\n`))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        let msg: { request_id?: number; error?: string; data?: unknown }
        try { msg = JSON.parse(line) as typeof msg } catch { continue }
        if (msg.request_id !== 1) continue
        finish(msg.error === 'success' ? undefined : new Error(`mpv control: ${msg.error ?? 'failed'}`), msg.data)
        return
      }
    })
    socket.once('error', (error) => finish(error))
    socket.once('end', () => finish(new Error('mpv control connection closed')))
  })
}

const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').normalize('NFC').toLowerCase() === b.replace(/\\/g, '/').normalize('NFC').toLowerCase()

export async function playerMatches(plan: TrackingPlan, fileName: string, filePath: string, allowEnded = false): Promise<boolean> {
  if (plan.kind === 'mpv') return samePath(String(await mpvCommand(plan, ['get_property', 'path'])), filePath)
  if (plan.kind === 'vlc') {
    const s = await vlcRequest(plan) as { state?: string; currentplid?: number; information?: { category?: { meta?: { filename?: string } } } }
    const name = s.information?.category?.meta?.filename
    if (typeof s.currentplid === 'number' && s.currentplid >= 0 && name) {
      // The status page exposes only a basename; the playlist distinguishes equal names in different folders.
      type Item = { id?: string | number; uri?: string; children?: Item[] }
      const find = (item: Item): string | undefined => {
        if (String(item.id) === String(s.currentplid) && item.uri) return item.uri
        for (const child of item.children ?? []) { const uri = find(child); if (uri) return uri }
      }
      const playlist = await fetch(`http://127.0.0.1:${plan.port}/requests/playlist.json`, {
        headers: vlcHeaders(plan), signal: AbortSignal.timeout(3000),
      }).then(async (res) => res.ok ? await res.json() as Item : null).catch(() => null)
      const uri = playlist ? find(playlist) : undefined
      if (uri?.startsWith('file:')) return samePath(fileURLToPath(uri), filePath)
    }
    return (allowEnded && s.state === 'stopped' && !name) || name?.normalize('NFC').toLowerCase() === fileName.normalize('NFC').toLowerCase()
  }
  const res = await fetch(`http://127.0.0.1:${plan.port}/variables.html`, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(`MPC control: HTTP ${res.status}`)
  const v = parseMpcVariables(await res.text())
  return v.filePath ? samePath(v.filePath, filePath) : v.file?.normalize('NFC').toLowerCase() === fileName.normalize('NFC').toLowerCase()
}

export async function confirmPlayerFile(plan: TrackingPlan, fileName: string, filePath: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await playerMatches(plan, fileName, filePath).catch(() => false)) return
    await delay(100)
  }
  throw new Error('The player did not open the next episode')
}

/** Only called with paths validated against fresh backend launch information. */
export async function loadInPlayer(plan: TrackingPlan, options: LaunchOptions, mpc?: MpcBridge): Promise<void> {
  if (plan.kind === 'vlc') {
    const query = new URLSearchParams({ command: 'in_play', input: pathToFileURL(options.path).href })
    query.append('option', `:start-time=${options.resumeSeconds ?? 0}`)
    query.append('option', `:sub-file=${options.subtitle ?? ''}`)
    query.append('option', `:sub-language=${options.languages.join(',')}`)
    await vlcRequest(plan, query)
  } else if (plan.kind === 'mpv') {
    // Clear startup options so the first episode's subtitle and resume offset cannot leak into later files.
    await mpvCommand(plan, ['set_property', 'options/sub-files', []])
    const fileOptions = { start: String(options.resumeSeconds ?? 0), slang: options.languages.join(',') }
    const version = String(await mpvCommand(plan, ['get_property', 'mpv-version']))
    const match = /(?:mpv\s+)?(\d+)\.(\d+)/.exec(version)
    const modern = !match || Number(match[1]) > 0 || Number(match[2]) >= 38
    await mpvCommand(plan, ['loadfile', options.path, 'replace', ...(modern ? [-1] : []), fileOptions])
  } else {
    if (!mpc) throw new Error('MPC control connection is unavailable')
    await mpc.load([
      options.path, '/play', '/start', String((options.resumeSeconds ?? 0) * 1000),
      ...(options.subtitle ? ['/sub', options.subtitle] : []), '/slave', mpc.slaveWindow,
    ])
  }
  const fileName = options.path.replace(/\\/g, '/').split('/').at(-1)!
  await confirmPlayerFile(plan, fileName, options.path)
  if (plan.kind === 'mpv') {
    if (options.subtitle) await mpvCommand(plan, ['sub-add', options.subtitle, 'select']).catch(() => undefined)
    await mpvCommand(plan, ['set_property', 'pause', false])
  }
}
