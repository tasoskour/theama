import { nextTick, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { GENRE_SEPARATOR, TitlePage, type GenreMode, TitleKind, type TitleSort, type TitleSummary } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'
import { navState } from '@/utils/navState'
import { useRefresh } from './useRefresh'

const PAGE_SIZE = 60
const MAX_PAGE_SIZE = 200 // the most the server returns in one page

interface Snapshot {
  items: TitleSummary[]
  total: number
  nextCursor: string | null
  q: string
  sort: TitleSort
  genres: string[]
  genreMode: GenreMode
  hideUnavailable: boolean
  view: 'browse' | 'all'
  scrollY: number
  focusKey: string | null
  /** The library revision when this was saved; a later one means the list may have changed while away. */
  revision: number
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
  /** Use this ref as the genre match mode: any of the genres, or all of them. */
  genreMode?: Ref<GenreMode>
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

  const items = shallowRef<TitleSummary[]>(snap?.items ?? [])
  const total = ref(snap?.total ?? 0)
  const nextCursor = ref<string | null>(snap?.nextCursor ?? null)
  const loading = ref(false)
  const loaded = ref(snap !== undefined)
  const error = ref<string | null>(null)
  const q = options.q ?? ref(snap?.q ?? '')
  const sort = ref<TitleSort>(snap?.sort ?? options.sort ?? 'title')
  const genres = options.genres ?? ref<string[]>(snap?.genres ?? [])
  const genreMode = options.genreMode ?? ref<GenreMode>(snap?.genreMode ?? 'any')
  const hideUnavailable = ref(snap?.hideUnavailable ?? false)
  const view = ref<'browse' | 'all'>(snap?.view ?? 'browse')

  let keepSize = 0 // the first page of the next reload is at least this long
  let generation = 0 // drops responses that belong to an older query
  let controller: AbortController | undefined
  let disposed = false
  const refresh = useRefresh(reload)

  function invalidate(): void {
    generation++
    controller?.abort()
    loading.value = false
  }

  async function fetchPage(cursor?: string): Promise<TitlePage | null> {
    const kind = options.kind()
    if (!connection.client || kind === null) return null
    return connection.client.get('/library/titles', TitlePage, {
      kind,
      q: q.value.trim() || undefined,
      sort: sort.value,
      genres: genres.value.join(GENRE_SEPARATOR) || undefined,
      genreMode: genres.value.length > 1 ? genreMode.value : undefined,
      hideUnavailable: hideUnavailable.value,
      limit: options.limit ?? (cursor ? PAGE_SIZE : Math.max(PAGE_SIZE, keepSize)),
      cursor,
    }, { signal: controller!.signal })
  }

  /** Replaces the list with a fresh first page. The old list stays visible meanwhile (no flicker). */
  async function reload(): Promise<void> {
    if (disposed) return
    controller?.abort()
    controller = new AbortController()
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
      const request = fetchPage()
      keepSize = 0 // applies to this request only
      const page = await request
      if (!page || mine !== generation) return
      items.value = page.items
      total.value = page.total
      nextCursor.value = page.nextCursor
      loaded.value = true
      error.value = null
    } catch (err) {
      if (mine === generation && !controller.signal.aborted) error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (loading.value || !nextCursor.value || options.limit !== undefined) return
    const mine = generation
    const request = new AbortController()
    controller = request
    loading.value = true
    try {
      const page = await fetchPage(nextCursor.value)
      if (!page || mine !== generation) return
      items.value = [...items.value, ...page.items]
      nextCursor.value = page.nextCursor
    } catch (err) {
      if (mine === generation && !request.signal.aborted) error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (mine === generation) loading.value = false
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
            items: items.value, total: total.value, nextCursor: nextCursor.value, q: q.value, sort: sort.value, genres: genres.value, genreMode: genreMode.value,
            hideUnavailable: hideUnavailable.value, view: view.value, scrollY: window.scrollY, focusKey: focusedKey(), revision: connection.getLibraryRevision(),
          })
          // Query strings can create arbitrarily many route keys during a long session.
          if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!)
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
        if (disposed) return
        window.scrollTo({ top: snap.scrollY })
        if (snap.focusKey) {
          document.dispatchEvent(new CustomEvent('theama:restore-title-focus', { detail: snap.focusKey }))
          document.querySelector<HTMLElement>(`[data-title-key="${CSS.escape(snap.focusKey)}"]`)?.focus({ preventScroll: true })
        }
      }),
    )
  }
  if (snap) restorePlace()

  // --- reacting to changes -------------------------------------------------------------------
  let debounce: ReturnType<typeof setTimeout> | undefined
  watch([q, sort, genres, genreMode, hideUnavailable], () => {
    invalidate()
    clearTimeout(debounce)
    debounce = setTimeout(() => void reload(), 250)
  })
  watch(
    () => connection.phase,
    (phase) => {
      if (phase !== 'connected') return
      // Coming back to a list we left: trust what we showed, unless the library changed meanwhile (e.g. a title was identified).
      if (snap && navState.arrivedByHistory) {
        if (snap.revision === connection.getLibraryRevision()) restorePlace()
        else {
          // Reload as many titles as were showing, so the person's place in a long list survives.
          keepSize = Math.min(items.value.length, MAX_PAGE_SIZE)
          void reload().then(restorePlace)
        }
      } else void reload().then(restorePlace)
    },
    { immediate: true },
  )
  const off = connection.onEvent((e) => {
    if (e.type === 'library.changed' || e.type === 'scan.finished') refresh.schedule()
  })
  onScopeDispose(() => {
    disposed = true
    invalidate()
    off()
    offBeforeEach?.()
    clearTimeout(debounce)
  })

  return { items, total, nextCursor, loading, loaded, error, q, sort, genres, genreMode, hideUnavailable, view, reload, loadMore }
}

export type TitlesList = ReturnType<typeof useTitles>
