import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { FavoriteList, FavoriteTitle, LibraryIdentities, RemoveFavoriteResult, providerIdentityKey, type ProviderIdentity } from '@theama/contracts'
import type { SuggestionItem } from '@/components/downloads/suggestion'
import { useConnectionStore } from './connection'

export const useFavoritesStore = defineStore('favorites', () => {
  const connection = useConnectionStore()
  const items = ref<FavoriteTitle[]>([])
  const identities = ref<ProviderIdentity[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const pending = ref(new Set<string>())
  const favoritesError = ref<string | null>(null)
  const libraryError = ref<string | null>(null)
  const mutationError = ref<string | null>(null)
  const error = computed(() => mutationError.value ?? favoritesError.value ?? libraryError.value)
  const favoriteKeys = computed(() => new Set(items.value.map(providerIdentityKey)))
  const libraryKeys = computed(() => new Set(identities.value.map(providerIdentityKey)))
  let favoriteGeneration = 0
  let libraryGeneration = 0
  let failedAction: { item: SuggestionItem; desired: boolean } | null = null

  const isFavorite = (item: ProviderIdentity): boolean => favoriteKeys.value.has(providerIdentityKey(item))
  const inLibrary = (item: ProviderIdentity): boolean => libraryKeys.value.has(providerIdentityKey(item))
  const isPending = (item: ProviderIdentity): boolean => pending.value.has(providerIdentityKey(item))
  const message = (err: unknown): string => err instanceof Error ? err.message : String(err)

  async function loadFavorites(): Promise<void> {
    if (!connection.client) return
    const mine = ++favoriteGeneration
    loading.value = true
    try {
      const result = await connection.client.get('/downloads/favorites', FavoriteList)
      if (mine !== favoriteGeneration) return
      items.value = result.items
      loaded.value = true
      favoritesError.value = null
    } catch (err) {
      if (mine === favoriteGeneration) favoritesError.value = message(err)
    } finally {
      if (mine === favoriteGeneration) loading.value = false
    }
  }

  async function loadLibrary(): Promise<void> {
    if (!connection.client) return
    const mine = ++libraryGeneration
    try {
      const result = await connection.client.get('/library/title-identities', LibraryIdentities)
      if (mine !== libraryGeneration) return
      identities.value = result.items
      libraryError.value = null
    } catch (err) {
      if (mine === libraryGeneration) libraryError.value = message(err)
    }
  }

  async function load(): Promise<void> {
    await Promise.all([loadFavorites(), loadLibrary()])
  }

  async function setFavorite(item: SuggestionItem, desired: boolean): Promise<void> {
    if (!connection.client || !loaded.value || isPending(item)) return
    const key = providerIdentityKey(item)
    pending.value.add(key)
    mutationError.value = null
    failedAction = null
    try {
      let saved: FavoriteTitle | null = null
      if (desired) {
        saved = await connection.client.put('/downloads/favorites', { ...item, rating: item.rating ?? null }, FavoriteTitle)
      } else {
        const path = [item.provider, item.kind, item.externalId].map(encodeURIComponent).join('/')
        await connection.client.delete(`/downloads/favorites/${path}`, RemoveFavoriteResult)
      }
      // Discard reads started before this write completed, including event-triggered refreshes.
      favoriteGeneration += 1
      loading.value = false
      const rest = items.value.filter((candidate) => providerIdentityKey(candidate) !== key)
      items.value = (saved ? [...rest, saved] : rest).sort((a, b) => b.savedAt.localeCompare(a.savedAt) || providerIdentityKey(a).localeCompare(providerIdentityKey(b)))
      // Reconcile concurrent edits from other windows after applying this action immediately.
      await loadFavorites()
    } catch (err) {
      mutationError.value = message(err)
      failedAction = { item, desired }
    } finally {
      pending.value.delete(key)
    }
  }

  const toggle = (item: SuggestionItem): Promise<void> => setFavorite(item, !isFavorite(item))
  async function retry(): Promise<void> {
    if (failedAction) await setFavorite(failedAction.item, failedAction.desired)
    else await load()
  }

  watch(() => connection.phase, (phase) => {
    if (phase === 'connected') void load()
  }, { immediate: true })
  connection.onEvent((event) => {
    if (event.type === 'library.changed') void loadLibrary()
    if (event.type === 'favorites.changed') void loadFavorites()
  })

  return { items, loaded, loading, error, isFavorite, inLibrary, isPending, load, loadFavorites, loadLibrary, toggle, retry }
})
