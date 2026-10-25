import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { DownloadToolsStatus, OpenDownloadToolResult, type DownloadTool } from '@theama/contracts'
import { getBridge } from '@/api/bridge'

export const VPN_STALE_MS = 25_000

export function isLocalDownloadAddress(raw: string | null | undefined): boolean {
  if (!raw) return true
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(raw).hostname) } catch { return false }
}

export const useDownloadToolsStore = defineStore('downloadTools', () => {
  const status = ref<DownloadToolsStatus | null>(null)
  const now = ref(Date.now())
  const checking = ref(false)
  const failed = ref(false)
  const opening = ref<Partial<Record<DownloadTool, boolean>>>({})
  const problem = ref<OpenDownloadToolResult['code']>(null)
  const available = !!getBridge()?.downloadTools
  let active = false
  let generation = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let pending: Promise<void> | null = null
  let lastAttempt = 0

  const stale = computed(() => !status.value || now.value - status.value.vpn.checkedAt >= VPN_STALE_MS)
  const vpnState = computed(() => failed.value || stale.value ? 'unknown' : status.value!.vpn.state)
  const vpnReason = computed(() => failed.value ? 'check_failed' : stale.value ? 'stale' : status.value!.vpn.reason)
  const qbRunning = computed(() => failed.value || stale.value ? null : status.value?.tools.qbittorrent.running ?? null)

  function refresh(): Promise<void> {
    if (pending) return pending
    const bridge = getBridge()?.downloadTools
    if (!bridge) return Promise.resolve()
    const mine = generation
    checking.value = true
    lastAttempt = Date.now()
    pending = (async () => {
      try {
        const result = DownloadToolsStatus.parse(await bridge.status())
        if (mine !== generation) return
        status.value = result
        failed.value = false
      } catch {
        if (mine === generation) failed.value = true
      } finally {
        now.value = Date.now()
        checking.value = false
        pending = null
        if (mine !== generation && active && !hidden()) void refresh()
      }
    })()
    return pending
  }

  const hidden = (): boolean => typeof document !== 'undefined' && document.hidden

  function visibilityChanged(): void {
    clearInterval(timer)
    timer = undefined
    now.value = Date.now()
    if (!active || hidden()) return
    void refresh()
    timer = setInterval(() => {
      now.value = Date.now()
      if (now.value - lastAttempt >= 10_000) void refresh()
    }, 1000)
  }

  function start(): void {
    if (active) return
    active = true
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibilityChanged)
    visibilityChanged()
  }

  function stop(): void {
    active = false
    generation += 1
    clearInterval(timer)
    timer = undefined
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged)
  }

  async function open(tool: DownloadTool): Promise<boolean> {
    const bridge = getBridge()?.downloadTools
    if (!bridge || opening.value[tool]) return false
    opening.value[tool] = true
    problem.value = null
    try {
      const result = OpenDownloadToolResult.parse(await bridge.open(tool))
      if (!result.ok) problem.value = result.code ?? 'launch_failed'
      return result.ok
    } catch {
      problem.value = 'launch_failed'
      return false
    } finally {
      opening.value[tool] = false
      // Refresh only if the person is still on a downloads screen.
      if (active) {
        // An existing check may have captured the process list before this app started.
        await pending
        if (active && !hidden()) await refresh()
      }
    }
  }

  return { status, checking, opening, problem, available, vpnState, vpnReason, qbRunning, start, stop, refresh, open }
})
