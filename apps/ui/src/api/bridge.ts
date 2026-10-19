import type { AppInfo, TheamaBridge } from '@theama/contracts'

export interface ApiEndpoint {
  apiBase: string | null
  wsUrl: string | null
  /** Only set when running in a plain browser during development. */
  token?: string
}

/** The Electron preload bridge, or null in a plain browser tab. */
export function getBridge(): TheamaBridge | null {
  return window.theama ?? null
}

export async function resolveEndpoint(): Promise<ApiEndpoint> {
  const bridge = getBridge()
  if (bridge) {
    const info: AppInfo = await bridge.appInfo()
    return { apiBase: info.apiBase, wsUrl: info.wsUrl }
  }
  const base = import.meta.env.VITE_API_BASE ?? null
  return {
    apiBase: base,
    wsUrl: base ? `${base.replace(/^http/, 'ws')}/api/v1/events` : null,
    token: import.meta.env.VITE_API_TOKEN,
  }
}
