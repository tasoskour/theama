import { onScopeDispose, ref, watch } from 'vue'
import { ContinueList, type ContinueItem } from '@theama/contracts'
import { useLatestRequest, useRefresh } from './useRefresh'
import { useConnectionStore } from '@/stores/connection'

/** The "continue watching" items, kept fresh when the library or what was watched changes. */
export function useContinueWatching(limit = 20) {
  const connection = useConnectionStore()
  const items = ref<ContinueItem[]>([])

  const latest = useLatestRequest()
  const refresh = useRefresh(load)
  async function load(): Promise<void> {
    const client = connection.client
    if (!client) return
    await latest(signal => client.get('/playback/continue', ContinueList, { limit }, { signal }), result => { items.value = result.items })
  }

  watch(() => connection.phase, (p) => p === 'connected' && void load(), { immediate: true })
  onScopeDispose(
    connection.onEvent((e) => {
      if (e.type === 'library.changed') refresh.schedule()
    }),
  )

  return { items, reload: load }
}
