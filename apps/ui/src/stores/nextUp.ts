import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { NextUp } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { usePlayersStore } from '@/stores/players'
import { useTitleActionsStore } from '@/stores/titleActions'

/**
 * "Up next": when an episode ends the desktop shell brings Theama forward and tells us which episode follows
 * and how long to wait. We count down, then start it; the person can start it at once or cancel.
 */
export const useNextUpStore = defineStore('nextUp', () => {
  const players = usePlayersStore()
  const actions = useTitleActionsStore()
  const current = ref<NextUp | null>(null)
  const remaining = ref(0)
  let timer: ReturnType<typeof setInterval> | undefined

  const open = computed(() => current.value !== null)

  function clear(): void {
    clearInterval(timer)
    timer = undefined
    current.value = null
  }

  async function playNow(): Promise<void> {
    const target = current.value
    if (!target) return
    clear()
    const result = await players.play(target.next.fileId)
    if (!result.ok) actions.notify(result.message ?? '', true)
  }

  function show(nextUp: NextUp): void {
    clear()
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

  getBridge()?.players.onNextUp(show)

  return { current, remaining, open, show, playNow, cancel: clear }
})
