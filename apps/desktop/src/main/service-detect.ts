import { existsSync, readFileSync } from 'node:fs'
import { win32 } from 'node:path'
import type { DetectedServices } from '@theama/contracts'
import { toolLocations } from './download-tools'

export interface DetectIo {
  exists(path: string): boolean
  read(path: string): string | null
}

export const realDetectIo: DetectIo = {
  exists: (path) => existsSync(path),
  read: (path) => { try { return readFileSync(path, 'utf8') } catch { return null } },
}

const tag = (xml: string, name: string): string | null => new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, 'i').exec(xml)?.[1] || null

/** Prowlarr keeps its API key and port in config.xml. Only a plain-http, local address is ever suggested. */
export function parseProwlarrConfig(xml: string): { url: string; apiKey: string | null } {
  const port = Number(tag(xml, 'Port'))
  const base = (tag(xml, 'UrlBase') ?? '').replace(/^\/+|\/+$/g, '')
  const apiKey = tag(xml, 'ApiKey')
  return {
    url: `http://localhost:${Number.isInteger(port) && port > 0 && port < 65536 ? port : 9696}${base ? `/${base}` : ''}`,
    apiKey: apiKey && apiKey.length >= 8 ? apiKey : null,
  }
}

/** qBittorrent stores `WebUI\Port=8080` style keys in its `[Preferences]` section. The password is only stored as a hash. */
export function parseQBittorrentIni(ini: string): { url: string; username: string | null; webUiEnabled: boolean } {
  const value = (key: string): string | null => {
    const line = ini.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(`${key.toLowerCase()}=`))
    return line ? line.slice(key.length + 1).trim() : null
  }
  const port = Number(value('WebUI\\Port'))
  return {
    url: `http://localhost:${Number.isInteger(port) && port > 0 && port < 65536 ? port : 8080}`,
    username: value('WebUI\\Username') || null,
    webUiEnabled: value('WebUI\\Enabled') === 'true',
  }
}

export function detectServices(env: NodeJS.ProcessEnv = process.env, io: DetectIo = realDetectIo): DetectedServices {
  const installed = (tool: 'prowlarr' | 'qbittorrent') => toolLocations(tool, env).some((p) => io.exists(p))
  const prowlarrDirs = [env.ProgramData ? win32.join(env.ProgramData, 'Prowlarr') : null, env.APPDATA ? win32.join(env.APPDATA, 'Prowlarr') : null, env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'Prowlarr') : null]
  let prowlarr: DetectedServices['prowlarr'] = { installed: installed('prowlarr'), url: null, apiKey: null }
  for (const dir of prowlarrDirs) {
    const xml = dir ? io.read(win32.join(dir, 'config.xml')) : null
    if (xml === null) continue
    prowlarr = { installed: true, ...parseProwlarrConfig(xml) }
    break
  }
  const ini = env.APPDATA ? io.read(win32.join(env.APPDATA, 'qBittorrent', 'qBittorrent.ini')) : null
  const qb = ini === null ? null : parseQBittorrentIni(ini)
  return {
    prowlarr,
    qbittorrent: { installed: installed('qbittorrent') || qb !== null, url: qb?.url ?? null, username: qb?.username ?? null, webUiEnabled: qb?.webUiEnabled ?? null },
  }
}
