import { onScopeDispose, ref, watch } from 'vue'
import { CollectionList, type CollectionSummary } from '@theama/contracts'
import { useLatestRequest, useRefresh } from './useRefresh'
import { useConnectionStore } from '@/stores/connection'

/**
 * Collections, optionally only those whose name matches a search. Pass a function returning the text to look
 * for (null = do not look at all). Reloads when the library changes.
 */
export function useCollections(query: () => string | null = () => '') {
  const connection = useConnectionStore()
  const items = ref<CollectionSummary[]>([])
  const latest = useLatestRequest()
  const refresh = useRefresh(load)

  async function load(): Promise<void> {
    const q = query()
    if (!connection.client || q === null) {
      await latest(async () => [], result => { items.value = result })
      return
    }
    const client = connection.client
    await latest(signal => client.get('/collections', CollectionList, q ? { q } : undefined, { signal }), result => { items.value = result.items })
  }

  watch(() => connection.phase, phase => phase === 'connected' && void load(), { immediate: true })
  let debounce: ReturnType<typeof setTimeout> | undefined
  watch(query, () => {
    latest.cancel()
    clearTimeout(debounce)
    if (query() === null) { items.value = []; return }
    debounce = setTimeout(() => { void load() }, 250)
  }, { flush: 'sync' })
  onScopeDispose(() => clearTimeout(debounce))
  onScopeDispose(
    connection.onEvent((e) => {
      if (e.type === 'library.changed') refresh.schedule()
    }),
  )

  return { items, reload: load }
}
