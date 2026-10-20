import { onScopeDispose, ref, watch } from 'vue'
import { CollectionList, type CollectionSummary } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'

/**
 * Collections, optionally only those whose name matches a search. Pass a function returning the text to look
 * for (null = do not look at all). Reloads when the library changes.
 */
export function useCollections(query: () => string | null = () => '') {
  const connection = useConnectionStore()
  const items = ref<CollectionSummary[]>([])
  let generation = 0

  async function load(): Promise<void> {
    const q = query()
    if (!connection.client || q === null) {
      items.value = []
      return
    }
    const mine = ++generation
    try {
      const result = (await connection.client.get('/collections', CollectionList, q ? { q } : undefined)).items
      if (mine === generation) items.value = result
    } catch {
      // A rail or a search group is a convenience; if it cannot load it simply is not there.
    }
  }

  watch([() => connection.phase, query], () => connection.phase === 'connected' && void load(), { immediate: true })
  onScopeDispose(
    connection.onEvent((e) => {
      if (e.type === 'library.changed') void load()
    }),
  )

  return { items, reload: load }
}
