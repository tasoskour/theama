import { onScopeDispose, ref, watch } from 'vue'
import { GenreList, type TitleKind } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'

/** The genres present in the library (for one kind of title, or all), refreshed when the library or its metadata changes. */
export function useGenres(kind: () => TitleKind | undefined) {
  const connection = useConnectionStore()
  const genres = ref<string[]>([])

  async function load(): Promise<void> {
    if (!connection.client) return
    try {
      genres.value = (await connection.client.get('/library/genres', GenreList, { kind: kind() })).genres
    } catch {
      // The filter is optional; without the list the page works as before.
    }
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
