import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { MetadataSearchResult, MetadataStatus, type MatchCandidate, type MatchKind } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import { useConnectionStore } from './connection'

export type MetadataResult = { ok: true } | { ok: false; code: string; message: string }

/** The metadata provider's state: whether a key is set, what is being looked up, how many titles are identified. */
export const useMetadataStore = defineStore('metadata', () => {
  const connection = useConnectionStore()
  const status = ref<MetadataStatus | null>(null)
  const error = ref<string | null>(null)

  async function load(): Promise<void> {
    if (!connection.client) return
    try {
      status.value = await connection.client.get('/metadata/status', MetadataStatus)
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  function failure(err: unknown): MetadataResult {
    if (err instanceof ApiRequestError) return { ok: false, code: err.code, message: err.message }
    return { ok: false, code: 'unreachable', message: err instanceof Error ? err.message : String(err) }
  }

  /** `null` removes the key. The backend checks a new key with TMDB before keeping it. */
  async function saveKey(key: string | null): Promise<MetadataResult> {
    if (!connection.client) return { ok: false, code: 'unreachable', message: 'Not connected' }
    try {
      status.value = await connection.client.put('/metadata/credentials', { tmdbApiKey: key }, MetadataStatus)
      return { ok: true }
    } catch (err) {
      return failure(err)
    }
  }

  async function retry(): Promise<void> {
    if (!connection.client) return
    try {
      status.value = await connection.client.post('/metadata/retry', {}, MetadataStatus)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function search(kind: MatchKind, q: string, year?: number): Promise<{ ok: true; items: MatchCandidate[] } | { ok: false; code: string; message: string }> {
    if (!connection.client) return { ok: false, code: 'unreachable', message: 'Not connected' }
    try {
      const res = await connection.client.get('/metadata/search', MetadataSearchResult, { kind, q, year })
      return { ok: true, items: res.items }
    } catch (err) {
      return failure(err) as { ok: false; code: string; message: string }
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
    if (e.type === 'metadata.status') status.value = e.status
  })

  return { status, error, load, saveKey, retry, search }
})
