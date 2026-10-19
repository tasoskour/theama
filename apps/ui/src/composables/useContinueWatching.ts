import { onScopeDispose, ref, watch } from 'vue'
import { ContinueList, type ContinueItem } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'

/** The "continue watching" items, kept fresh when the library or what was watched changes. */
export function useContinueWatching(limit = 20) {
  const connection = useConnectionStore()
  const items = ref<ContinueItem[]>([])

  async function load(): Promise<void> {
    if (!connection.client) return
    try {
      items.value = (await connection.client.get('/playback/continue', ContinueList, { limit })).items
    } catch {
      // The rail is a convenience; if it cannot load, Home simply shows the other rails.
    }
  }

  watch(() => connection.phase, (p) => p === 'connected' && void load(), { immediate: true })
  onScopeDispose(
    connection.onEvent((e) => {
      if (e.type === 'library.changed') void load()
    }),
  )

  return { items, reload: load }
}
