import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { z } from 'zod'
import {
  LibrarySource,
  LibrarySourceList,
  type LibraryType,
  type UpdateSourceRequest,
} from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import { useConnectionStore } from './connection'

export type LibraryResult = { ok: true; source: LibrarySource } | { ok: false; code: string; message: string }

export const useLibraryStore = defineStore('library', () => {
  const connection = useConnectionStore()
  const sources = ref<LibrarySource[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const count = computed(() => sources.value.length)
  const offlineCount = computed(() => sources.value.filter((s) => s.availability === 'offline').length)

  async function load(): Promise<void> {
    if (!connection.client || loading.value) return
    loading.value = true
    try {
      sources.value = (await connection.client.get('/library/sources', LibrarySourceList)).items
      loaded.value = true
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function failure(err: unknown): LibraryResult {
    if (err instanceof ApiRequestError) return { ok: false, code: err.code, message: err.message }
    return { ok: false, code: 'unreachable', message: err instanceof Error ? err.message : String(err) }
  }

  async function add(path: string, libraryType: LibraryType, recursive = true): Promise<LibraryResult> {
    if (!connection.client) return { ok: false, code: 'unreachable', message: 'Not connected' }
    try {
      const source = await connection.client.post('/library/sources', { path, libraryType, recursive }, LibrarySource)
      await load()
      return { ok: true, source }
    } catch (err) {
      return failure(err)
    }
  }

  async function update(id: number, patch: UpdateSourceRequest): Promise<LibraryResult> {
    if (!connection.client) return { ok: false, code: 'unreachable', message: 'Not connected' }
    try {
      const source = await connection.client.patch(`/library/sources/${id}`, patch, LibrarySource)
      sources.value = sources.value.map((s) => (s.id === id ? source : s))
      return { ok: true, source }
    } catch (err) {
      return failure(err)
    }
  }

  /** Removes the folder from Theama only; the server never touches files on disk. */
  async function remove(id: number): Promise<boolean> {
    if (!connection.client) return false
    try {
      await connection.client.delete(`/library/sources/${id}`, z.object({ deleted: z.boolean() }))
      sources.value = sources.value.filter((s) => s.id !== id)
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  watch(
    () => connection.phase,
    (phase) => {
      if (phase === 'connected') void load()
    },
    { immediate: true },
  )
  connection.onEvent((e) => {
    if (e.type === 'library.changed') void load()
  })

  return { sources, loaded, loading, error, count, offlineCount, load, add, update, remove }
})
