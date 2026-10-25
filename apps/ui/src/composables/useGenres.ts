import { onScopeDispose, ref, watch } from 'vue'
import { GenreList, type TitleKind } from '@theama/contracts'
import { useLatestRequest } from './useRefresh'
import { useConnectionStore } from '@/stores/connection'

/** The genres present in the library (for one kind of title, or all), refreshed when the library or its metadata changes. */
export function useGenres(kind: () => TitleKind | undefined) {
  const connection = useConnectionStore()
  const genres = ref<string[]>([])

  const latest = useLatestRequest()
  async function load(): Promise<void> {
    const client = connection.client
    if (!client) return
    await latest(signal => client.get('/library/genres', GenreList, { kind: kind() }, { signal }), result => { genres.value = result.genres })
  }

  // Metadata status changes arrive in bursts while titles are being identified.
  let debounce: ReturnType<typeof setTimeout> | undefined
  const later = (): void => {
    clearTimeout(debounce)
    debounce = setTimeout(() => void load(), 500)
  }
  const off = connection.onEvent((e) => {
    if (e.type === 'library.changed' || e.type === 'scan.finished' || e.type === 'metadata.status') later()
  })
  watch(() => connection.phase, (phase) => phase === 'connected' && void load(), { immediate: true })
  onScopeDispose(() => {
    off()
    clearTimeout(debounce)
  })

  return { genres }
}
