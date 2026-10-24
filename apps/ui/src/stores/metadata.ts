import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  GENRE_SEPARATOR,
  GenreList,
  MetadataSearchResult,
  MetadataStatus,
  MetadataSuggestionDetails,
  MetadataSuggestionsResult,
  type MatchCandidate,
  type MatchKind,
  type GenreMode,
  type SuggestionSection,
} from '@theama/contracts'
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

  async function genres(): Promise<({ ok: true } & GenreList) | { ok: false; code: string; message: string }> {
    if (!connection.client) return { ok: false, code: 'unreachable', message: 'Not connected' }
    try {
      return { ok: true, ...await connection.client.get('/metadata/genres', GenreList) }
    } catch (err) {
      return failure(err) as { ok: false; code: string; message: string }
    }
  }

  /** One page of a suggestions section (what is new, or a year's most popular). The server remembers pages, so asking again is cheap. */
  async function suggestions(
    section: SuggestionSection,
    year: number | undefined,
    page: number,
    genres: string[] = [],
    genreMode: GenreMode = 'any',
  ): Promise<({ ok: true } & MetadataSuggestionsResult) | { ok: false; code: string; message: string }> {
    if (!connection.client) return { ok: false, code: 'unreachable', message: 'Not connected' }
    try {
      const res = await connection.client.get('/metadata/suggestions', MetadataSuggestionsResult, {
        section, year, page, genres: genres.join(GENRE_SEPARATOR) || undefined, genreMode: genres.length > 1 ? genreMode : undefined,
      })
      return { ok: true, ...res }
    } catch (err) {
      return failure(err) as { ok: false; code: string; message: string }
    }
  }

  /** The IMDb id and trailer of a suggestion, looked up the first time they are wanted. */
  const details = new Map<string, MetadataSuggestionDetails>()

  async function suggestionDetails(kind: MatchKind, externalId: string): Promise<({ ok: true } & MetadataSuggestionDetails) | { ok: false; code: string; message: string }> {
    const key = `${kind}:${externalId}`
    const known = details.get(key)
    if (known) return { ok: true, ...known }
    if (!connection.client) return { ok: false, code: 'unreachable', message: 'Not connected' }
    try {
      const res = await connection.client.get('/metadata/suggestions/details', MetadataSuggestionDetails, { kind, externalId })
      details.set(key, res)
      return { ok: true, ...res }
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

  return { status, error, load, saveKey, retry, search, genres, suggestions, suggestionDetails }
})
