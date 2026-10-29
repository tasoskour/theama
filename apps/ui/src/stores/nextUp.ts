import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { NextUpOffer } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useTitleActionsStore } from '@/stores/titleActions'

/**
 * "Up next": when an episode ends the desktop shell brings Theama forward and tells us which episode follows
 * and how long to wait. We count down, then start it; the person can start it at once or cancel.
 */
export const useNextUpStore = defineStore('nextUp', () => {
  const bridge = getBridge()
  const actions = useTitleActionsStore()
  const current = ref<NextUpOffer | null>(null)
  const remaining = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined
  const seen = new Set<string>()

  const open = computed(() => current.value !== null)

  function clear(): void {
    clearInterval(timer)
    timer = undefined
    current.value = null
  }

  function cancel(): void {
    const offerId = current.value?.offerId
    clear()
    if (offerId) void bridge?.players.cancelNext(offerId).catch(() => undefined)
  }

  async function playNow(): Promise<void> {
    const target = current.value
    if (!target) return
    clear()
    try {
      const result = await bridge?.players.playNext(target.offerId)
      if (result && !result.ok) actions.notify(result.message ?? '', true)
    } catch (err) {
      actions.notify(err instanceof Error ? err.message : String(err), true)
    }
  }

  function show(nextUp: NextUpOffer): void {
    if (seen.has(nextUp.offerId)) return
    seen.add(nextUp.offerId)
    cancel()
    current.value = nextUp
    remaining.value = nextUp.countdownSeconds
    if (nextUp.countdownSeconds <= 0) {
      void playNow()
      return
    }
    timer = setInterval(() => {
      remaining.value -= 1
      if (remaining.value <= 0) void playNow()
    }, 1000)
  }

  bridge?.players.onNextUp(show)
  bridge?.players.onNextUpCancelled((offerId) => {
    if (current.value?.offerId === offerId) clear()
  })

  return { current, remaining, open, show, playNow, cancel }
})
