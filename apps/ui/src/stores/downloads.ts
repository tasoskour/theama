import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { z } from 'zod'
import { DownloadClientStatus, DownloadFileList, DownloadList, IndexerStatus, ReleaseList, type DownloadFile, type ReleaseKind, type ReleaseSource } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import { useConnectionStore } from './connection'

type Failure = { ok: false; code: string; message: string }
export type DownloadResult = { ok: true } | Failure
export type FilesResult = { ok: true; files: DownloadFile[] } | Failure
export type ReleasesResult = { ok: true; value: ReleaseList } | Failure

export interface ReleaseSearch {
  kind: ReleaseKind
  title: string
  year?: number | undefined
  season?: number | undefined
  episode?: number | undefined
  source?: ReleaseSource | undefined
  /** Keep results that do not look like the title. */
  unmatched?: boolean | undefined
}

const Done = z.object({ ok: z.literal(true) })

/** The qBittorrent and Prowlarr connections, and searching for and adding downloads through them. */
export const useDownloadsStore = defineStore('downloads', () => {
  const connection = useConnectionStore()
  const client = ref<DownloadClientStatus | null>(null)
  const indexer = ref<IndexerStatus | null>(null)
  const statusError = ref(false)
  /** Configured providers can be retried even when they are temporarily unreachable. */
  const canFindReleases = computed(() =>
    (client.value !== null && client.value.state !== 'not_configured') ||
    (indexer.value !== null && indexer.value.state !== 'not_configured'),
  )
  /** What qBittorrent is downloading for us; kept fresh by pushes from the service. */
  const list = ref<DownloadList | null>(null)

  function failure(err: unknown): Failure {
    if (err instanceof ApiRequestError) return { ok: false, code: err.code, message: err.message }
    return { ok: false, code: 'unreachable', message: err instanceof Error ? err.message : String(err) }
  }
  const notConnected: Failure = { ok: false, code: 'unreachable', message: 'Not connected' }

  let pendingLoad: Promise<void> | null = null
  let settingsRevision = 0
  let listRevision = 0
  function load(): Promise<void> {
    if (pendingLoad) return pendingLoad
    pendingLoad = loadStatus().finally(() => { pendingLoad = null })
    return pendingLoad
  }

  async function loadStatus(): Promise<void> {
    if (!connection.client) return
    const api = connection.client
    const revision = settingsRevision
    const listAtStart = listRevision
    try {
      const [c, i, l] = await Promise.all([
        api.get('/downloads/status', DownloadClientStatus),
        api.get('/downloads/indexer', IndexerStatus),
        api.get('/downloads', DownloadList),
      ])
      if (connection.client !== api || revision !== settingsRevision) return
      client.value = c
      indexer.value = i
      statusError.value = false
      if (listAtStart === listRevision) list.value = l
    } catch {
      statusError.value = true
      // The settings page shows "unknown" until the service answers.
    }
  }

  /** `null` forgets qBittorrent. The server checks the login before keeping it. */
  async function saveClient(next: { url: string; username: string; password: string } | null): Promise<DownloadResult> {
    if (!connection.client) return notConnected
    try {
      const result = await connection.client.put('/downloads/client', { qbittorrent: next }, DownloadClientStatus)
      settingsRevision++
      client.value = result
      return { ok: true }
    } catch (err) {
      return failure(err)
    }
  }

  async function saveIndexer(next: { url: string; apiKey: string } | null): Promise<DownloadResult> {
    if (!connection.client) return notConnected
    try {
      const result = await connection.client.put('/downloads/indexer', { prowlarr: next }, IndexerStatus)
      settingsRevision++
      indexer.value = result
      return { ok: true }
    } catch (err) {
      return failure(err)
    }
  }

  async function findReleases(q: ReleaseSearch, signal?: AbortSignal): Promise<ReleasesResult> {
    if (!connection.client) return notConnected
    try {
      const { kind, title, year, season, episode, source, unmatched } = q
      return { ok: true, value: await connection.client.get('/downloads/releases', ReleaseList, { kind, title, year, season, episode, source, unmatched: unmatched ? true : undefined },signal ? { signal } : undefined) }
    } catch (err) {
      return failure(err)
    }
  }

  async function download(releaseId: string, kind: ReleaseKind): Promise<DownloadResult> {
    if (!connection.client) return notConnected
    try {
      await connection.client.post('/downloads', { releaseId, kind }, Done)
      return { ok: true }
    } catch (err) {
      return failure(err)
    }
  }

  async function setPaused(hash: string, paused: boolean): Promise<DownloadResult> {
    if (!connection.client) return notConnected
    try {
      await connection.client.post(`/downloads/${hash}/${paused ? 'pause' : 'resume'}`, {}, Done)
      return { ok: true }
    } catch (err) {
      return failure(err)
    }
  }

  async function files(hash: string): Promise<FilesResult> {
    if (!connection.client) return notConnected
    try {
      return { ok: true, files: (await connection.client.get(`/downloads/${hash}/files`, DownloadFileList)).files }
    } catch (err) {
      return failure(err)
    }
  }

  /** Download exactly these files of the torrent and skip the rest. */
  async function selectFiles(hash: string, wanted: number[]): Promise<DownloadResult> {
    if (!connection.client) return notConnected
    try {
      await connection.client.put(`/downloads/${hash}/files`, { wanted }, Done)
      return { ok: true }
    } catch (err) {
      return failure(err)
    }
  }

  async function remove(hash: string, deleteFiles: boolean): Promise<DownloadResult> {
    if (!connection.client) return notConnected
    try {
      await connection.client.delete(`/downloads/${hash}?deleteFiles=${deleteFiles}`, Done)
      return { ok: true }
    } catch (err) {
      return failure(err)
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
    if (e.type === 'downloads.changed') { listRevision++; list.value = e.list }
  })

  return { client, indexer, statusError, canFindReleases, list, setPaused, files, selectFiles, remove, load, saveClient, saveIndexer, findReleases, download }
})
