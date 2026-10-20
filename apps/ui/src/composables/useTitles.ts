import { nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { GENRE_SEPARATOR, TitlePage, type TitleKind, type TitleSort, type TitleSummary } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'
import { navState } from '@/utils/navState'

const PAGE_SIZE = 60

interface Snapshot {
  items: TitleSummary[]
  total: number
  nextCursor: string | null
  q: string
  sort: TitleSort
  genres: string[]
  hideUnavailable: boolean
  scrollY: number
  focusKey: string | null
}
/** Per route, so coming back from a details page shows the same list at the same place. */
const snapshots = new Map<string, Snapshot>()

export interface UseTitlesOptions {
  /** Which kind of title to list, or undefined for all kinds. `null` = this page lists nothing (no requests). */
  kind: () => TitleKind | undefined | null
  sort?: TitleSort
  /** Page size; rails use a small fixed page and never page further. */
  limit?: number
  /** Remember and restore list, scroll position and focused card across navigation. */
  remember?: boolean
  /** Use this ref as the search text (the page owns the input). */
  q?: Ref<string>
  /** Use this ref as the chosen genres (a title needs any one of them). */
  genres?: Ref<string[]>
}

/**
 * A searchable, sortable, paged list of titles. Reloads when the library changes (scan finished,
 * folder added/removed) and when the backend reconnects.
 */
export function useTitles(options: UseTitlesOptions) {
  const connection = useConnectionStore()
  const router = useRouter()
  const route = useRoute()
  const routeKey = route.fullPath
  const snap = options.remember ? snapshots.get(routeKey) : undefined

  const items = ref<TitleSummary[]>(snap?.items ?? [])
  const total = ref(snap?.total ?? 0)
  const nextCursor = ref<string | null>(snap?.nextCursor ?? null)
  const loading = ref(false)
  const loaded = ref(snap !== undefined)
  const error = ref<string | null>(null)
  const q = options.q ?? ref(snap?.q ?? '')
  const sort = ref<TitleSort>(snap?.sort ?? options.sort ?? 'title')
  const genres = options.genres ?? ref<string[]>(snap?.genres ?? [])
  const hideUnavailable = ref(snap?.hideUnavailable ?? false)

  let generation = 0 // drops responses that belong to an older query

  async function fetchPage(cursor?: string): Promise<TitlePage | null> {
    const kind = options.kind()
    if (!connection.client || kind === null) return null
    return connection.client.get('/library/titles', TitlePage, {
      kind,
      q: q.value.trim() || undefined,
      sort: sort.value,
      genres: genres.value.join(GENRE_SEPARATOR) || undefined,
      hideUnavailable: hideUnavailable.value,
      limit: options.limit ?? PAGE_SIZE,
      cursor,
    })
  }

  /** Replaces the list with a fresh first page. The old list stays visible meanwhile (no flicker). */
  async function reload(): Promise<void> {
    const mine = ++generation
    if (options.kind() === null) {
      // A page with nothing to list (e.g. Search with an empty box) shows an empty list, never stale results.
      items.value = []
      total.value = 0
      nextCursor.value = null
      loading.value = false
      return
    }
    loading.value = true
    try {
      const page = await fetchPage()
      if (!page || mine !== generation) return
      items.value = page.items
      total.value = page.total
      nextCursor.value = page.nextCursor
      loaded.value = true
      error.value = null
    } catch (err) {
      if (mine === generation) error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (loading.value || !nextCursor.value || options.limit !== undefined) return
    const mine = generation
    loading.value = true
    try {
      const page = await fetchPage(nextCursor.value)
      if (!page || mine !== generation) return
      items.value = [...items.value, ...page.items]
      nextCursor.value = page.nextCursor
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  // --- remembering the place -----------------------------------------------------------------
  function focusedKey(): string | null {
    const el = document.activeElement
    return el instanceof HTMLElement ? (el.closest<HTMLElement>('[data-title-key]')?.dataset.titleKey ?? null) : null
  }
  const offBeforeEach = options.remember
    ? router.beforeEach((_to, from) => {
        // Runs before the page changes, while scroll position and focus are still the list's.
        if (from.fullPath === routeKey) {
          snapshots.set(routeKey, {
            items: items.value, total: total.value, nextCursor: nextCursor.value, q: q.value, sort: sort.value, genres: genres.value,
            hideUnavailable: hideUnavailable.value, scrollY: window.scrollY, focusKey: focusedKey(),
          })
        }
        return true
      })
    : null

  let restored = false
  function restorePlace(): void {
    if (restored || !snap || !navState.arrivedByHistory || items.value.length === 0) return
    restored = true
    void nextTick(() =>
      requestAnimationFrame(() => {
        window.scrollTo({ top: snap.scrollY })
        if (snap.focusKey) {
          document.querySelector<HTMLElement>(`[data-title-key="${CSS.escape(snap.focusKey)}"]`)?.focus({ preventScroll: true })
        }
      }),
    )
  }
  if (snap) restorePlace()

  // --- reacting to changes -------------------------------------------------------------------
  let debounce: ReturnType<typeof setTimeout> | undefined
  watch([q, sort, genres, hideUnavailable], () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => void reload(), 250)
  })
  watch(
    () => connection.phase,
    (phase) => {
      if (phase !== 'connected') return
      // Coming back to a list we left: trust what we showed (a refresh would cut a long list back to one page).
      if (snap && navState.arrivedByHistory) restorePlace()
      else void reload().then(restorePlace)
    },
    { immediate: true },
  )
  const off = connection.onEvent((e) => {
    if (e.type === 'library.changed' || e.type === 'scan.finished') void reload()
  })
  onScopeDispose(() => {
    off()
    offBeforeEach?.()
    clearTimeout(debounce)
  })

  return { items, total, nextCursor, loading, loaded, error, q, sort, genres, hideUnavailable, reload, loadMore }
}

export type TitlesList = ReturnType<typeof useTitles>
