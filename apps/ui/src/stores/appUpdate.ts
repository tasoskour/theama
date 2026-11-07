import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { UpdateState } from '@theama/contracts'
import { getBridge } from '@/api/bridge'

/**
 * App updates: when the desktop shell finds a new version at start-up it waits for a decision.
 * The person can update now, update when Theama is next closed, or skip it.
 */
export const useAppUpdateStore = defineStore('appUpdate', () => {
  const bridge = getBridge()
  const state = ref<UpdateState | null>(null)
  /** True after a choice was made here, so a failed download is shown (a failed start-up check is not). */
  const chosen = ref(false)

  const open = computed(() => {
    const s = state.value
    if (!s) return false
    if (s.status === 'available') return true
    if (!chosen.value) return false
    return s.status === 'error' || (s.installWhenReady && (s.status === 'downloading' || s.status === 'ready'))
  })

  async function run(action: () => Promise<unknown> | undefined): Promise<void> {
    try {
      await action()
    } catch {
      // The desktop app reports a failure through the update state.
    }
  }

  function updateNow(): Promise<void> {
    chosen.value = true
    return run(() => bridge?.updates.download('now'))
  }
  function updateOnClose(): Promise<void> {
    chosen.value = true
    return run(() => bridge?.updates.download('quit'))
  }
  function skip(): Promise<void> {
    chosen.value = false
    return run(() => bridge?.updates.skip())
  }
  /** Closes the dialog after a failed download. */
  function dismiss(): void {
    chosen.value = false
  }

  void bridge?.updates.state().then((s) => (state.value = s)).catch(() => undefined)
  bridge?.updates.onState((s) => (state.value = s))

  return { state, open, updateNow, updateOnClose, skip, dismiss }
})
