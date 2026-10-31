import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { DownloadToolsStatus, OpenDownloadToolResult, type DownloadTool, type VpnLocation } from '@theama/contracts'
import { getBridge } from '@/api/bridge'

export const VPN_STALE_MS = 25_000
// A single failed poll keeps the last known result; the warning appears when it repeats.
const FAILURES_BEFORE_WARNING = 2

// The timestamp changes on every poll; leaving it out means unchanged polls do not touch the UI.
function signature(status: DownloadToolsStatus): string {
  const { checkedAt: _checkedAt, ...vpn } = status.vpn
  return JSON.stringify({ vpn, tools: status.tools })
}

export function isLocalDownloadAddress(raw: string | null | undefined): boolean {
  if (!raw) return true
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(raw).hostname) } catch { return false }
}

export const useDownloadToolsStore = defineStore('downloadTools', () => {
  const status = ref<DownloadToolsStatus | null>(null)
  const now = ref(Date.now())
  const checking = ref(false)
  const manualChecking = ref(false)
  const checkedAt = ref(0)
  const inFlightSince = ref(0)
  const failures = ref(0)
  const opening = ref<Partial<Record<DownloadTool, boolean>>>({})
  const problem = ref<OpenDownloadToolResult['code']>(null)
  const available = !!getBridge()?.downloadTools
  let active = false
  let generation = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let pending: Promise<void> | null = null
  let lastAttempt = 0
  let lastSignature = ''

  const failed = computed(() => failures.value >= FAILURES_BEFORE_WARNING || (failures.value > 0 && !status.value))
  // Only the very first check of the session has nothing to show yet; later visits reuse the last result.
  const initializing = computed(() => !status.value && !failed.value)
  // The last result stays valid while a fresh check runs. It expires only if that check hangs.
  const stale = computed(() => !status.value || now.value - (checking.value ? inFlightSince.value : checkedAt.value) >= VPN_STALE_MS)
  const vpnState = computed(() => failed.value || stale.value ? 'unknown' : status.value!.vpn.state)
  const vpnReason = computed(() => failed.value ? 'check_failed' : stale.value ? 'stale' : status.value!.vpn.reason)
  const qbRunning = computed(() => failed.value || stale.value ? null : status.value?.tools.qbittorrent.running ?? null)
  const vpnLocation = computed<VpnLocation | null>(() => vpnState.value === 'connected' ? status.value?.vpn.location ?? null : null)

  function refresh(): Promise<void> {
    if (pending) return pending
    const bridge = getBridge()?.downloadTools
    if (!bridge) return Promise.resolve()
    const mine = generation
    checking.value = true
    lastAttempt = inFlightSince.value = Date.now()
    pending = (async () => {
      try {
        const result = DownloadToolsStatus.parse(await bridge.status())
        if (mine !== generation) return
        const next = signature(result)
        if (next !== lastSignature) { status.value = result; lastSignature = next }
        checkedAt.value = result.vpn.checkedAt
        failures.value = 0
      } catch {
        if (mine === generation) failures.value += 1
      } finally {
        now.value = Date.now()
        checking.value = false
        pending = null
        if (mine !== generation && active && !hidden()) void refresh()
      }
    })()
    return pending
  }

  async function recheck(): Promise<void> {
    manualChecking.value = true
    try { await refresh() } finally { manualChecking.value = false }
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

  return { status, checking, manualChecking, initializing, opening, problem, available, vpnState, vpnReason, vpnLocation, qbRunning, start, stop, refresh, recheck, open }
})
