import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { HEARTBEAT_INTERVAL_MS, HealthResponse, ServerEvent } from '@theama/contracts'
import { ApiClient } from '@/api/client'
import { getBridge, resolveEndpoint } from '@/api/bridge'

export type ConnectionPhase = 'connecting' | 'connected' | 'unavailable'

const RETRY_MS = 3000
/** 2.5 missed heartbeats means the socket is half-open and must be replaced. */
const WATCHDOG_MS = HEARTBEAT_INTERVAL_MS * 2.5

function safeJson(data: unknown): unknown {
  try {
    return JSON.parse(String(data))
  } catch {
    return null
  }
}

export const useConnectionStore = defineStore('connection', () => {
  const phase = ref<ConnectionPhase>('connecting')
  const client = shallowRef<ApiClient | null>(null)
  const desktop = ref(getBridge() !== null)
  const everConnected = ref(false)
  const apiBase = ref<string | null>(null)
  const listeners = new Set<(event: ServerEvent) => void>()

  let wsUrl: string | null = null
  let socket: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let started = false

  const isConnected = computed(() => phase.value === 'connected')

  function onEvent(listener: (event: ServerEvent) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function armWatchdog(): void {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => socket?.close(), WATCHDOG_MS)
  }

  function scheduleRetry(delay = RETRY_MS): void {
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => void connect(), delay)
  }

  function markUnavailable(): void {
    clearTimeout(watchdog)
    socket = null
    phase.value = 'unavailable'
    scheduleRetry()
  }

  async function connect(): Promise<void> {
    // The endpoint is re-resolved on every attempt: after a service restart
    // the desktop shell may report a different port.
    try {
      const endpoint = await resolveEndpoint()
      if (!endpoint.apiBase) throw new Error('No backend endpoint is known yet')
      client.value = new ApiClient(endpoint.apiBase, endpoint.token)
      apiBase.value = endpoint.apiBase
      wsUrl = endpoint.wsUrl
      await client.value.get('/health', HealthResponse)
    } catch {
      markUnavailable()
      return
    }
    openSocket()
  }

  function openSocket(): void {
    if (!wsUrl) return markUnavailable()
    const ws = new WebSocket(wsUrl)
    socket = ws
    ws.onopen = () => {
      phase.value = 'connected'
      everConnected.value = true
      armWatchdog()
    }
    ws.onmessage = (msg) => {
      armWatchdog()
      const parsed = ServerEvent.safeParse(safeJson(msg.data))
      if (parsed.success) for (const l of listeners) l(parsed.data)
    }
    ws.onclose = () => {
      if (socket === ws) markUnavailable()
    }
    ws.onerror = () => ws.close()
  }

  /** Begins connecting; safe to call more than once. */
  function start(): void {
    if (started) return
    started = true
    void connect()
  }

  /** Immediate re-check, used by the recovery screen's Retry button. */
  function retryNow(): void {
    clearTimeout(retryTimer)
    socket?.close()
    phase.value = 'connecting'
    void connect()
  }

  /**
   * Absolute URL for a backend-served file such as cached artwork. The desktop shell attaches the API
   * token to these requests, so the images need no credentials in the URL.
   */
  function assetUrl(path: string | null | undefined): string | null {
    return path && apiBase.value ? `${apiBase.value}${path}` : null
  }

  return { phase, client, desktop, everConnected, isConnected, apiBase, assetUrl, start, retryNow, onEvent }
})
