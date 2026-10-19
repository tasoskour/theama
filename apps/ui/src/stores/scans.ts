import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { z } from 'zod'
import { LibraryStatus, ScanJob, ScanJobList, type ScanProgress } from '@theama/contracts'
import { useConnectionStore } from './connection'

export const useScansStore = defineStore('scans', () => {
  const connection = useConnectionStore()
  /** Newest first. */
  const jobs = ref<ScanJob[]>([])
  const progress = ref<Record<number, ScanProgress>>({})
  const status = ref<LibraryStatus | null>(null)
  const error = ref<string | null>(null)

  const scanning = computed(() => Object.keys(progress.value).length > 0 || jobs.value.some((j) => j.status === 'running' || j.status === 'queued'))
  const ffprobeAvailable = computed(() => status.value?.ffprobeAvailable ?? true)

  function latestFor(sourceId: number): ScanJob | null {
    return jobs.value.find((j) => j.sourceId === sourceId) ?? null
  }

  /** A scan that is queued or running for this folder, if any. */
  function activeFor(sourceId: number): ScanJob | null {
    const j = latestFor(sourceId)
    return j && (j.status === 'running' || j.status === 'queued') ? j : null
  }

  function upsert(job: ScanJob): void {
    jobs.value = [job, ...jobs.value.filter((j) => j.id !== job.id)].sort((a, b) => b.id - a.id)
  }

  async function load(): Promise<void> {
    if (!connection.client) return
    try {
      jobs.value = (await connection.client.get('/scans', ScanJobList, { limit: 100 })).items
      status.value = await connection.client.get('/library/status', LibraryStatus)
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function scanNow(sourceId: number): Promise<void> {
    if (!connection.client) return
    try {
      upsert(await connection.client.post(`/library/sources/${sourceId}/scan`, undefined, ScanJob))
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function cancel(jobId: number): Promise<void> {
    if (!connection.client) return
    try {
      await connection.client.post(`/scans/${jobId}/cancel`, undefined, z.object({ cancelled: z.boolean() }))
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
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
    switch (e.type) {
      case 'scan.started':
        upsert(e.job)
        progress.value = { ...progress.value, [e.job.sourceId]: { jobId: e.job.id, sourceId: e.job.sourceId, phase: 'walking', found: 0, toProbe: 0, probed: 0 } }
        break
      case 'scan.progress':
        progress.value = { ...progress.value, [e.progress.sourceId]: e.progress }
        break
      case 'scan.finished': {
        upsert(e.job)
        const { [e.job.sourceId]: _done, ...rest } = progress.value
        progress.value = rest
        void load() // refresh counts (file total, scanning flag)
        break
      }
    }
  })

  return { jobs, progress, status, error, scanning, ffprobeAvailable, latestFor, activeFor, load, scanNow, cancel }
})
