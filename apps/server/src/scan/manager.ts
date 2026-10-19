import { cpus } from 'node:os'
import type { Logger } from 'pino'
import type { LibraryStatus, ScanJob, ScanProgress, ServerEvent } from '@theama/contracts'
import { LibrarySourceRepo, checkAvailability, pathKey } from '../library/sources'
import type { ProbeFn } from './probe'
import { runScan, type ScanOutcome } from './scanner'
import type { MediaFileRepo, ScanJobRepo } from './store'

export interface ScanManagerDeps {
  library: LibrarySourceRepo
  files: MediaFileRepo
  jobs: ScanJobRepo
  /** null when FFprobe is not installed. */
  probe: ProbeFn | null
  emit: (event: ServerEvent) => void
  logger: Logger
  probeConcurrency?: number
  /** Progress events are throttled to this interval. */
  progressIntervalMs?: number
  now?: () => Date
  /** Replaceable in tests. */
  scan?: typeof runScan
}

/**
 * Runs scans one at a time. Jobs are persisted (`scan_job`), progress is pushed over
 * WebSocket, and a scan can be cancelled. Triggers (folder added, "Scan now", file
 * changes, drive back online, service start) all go through `enqueue`.
 */
export class ScanManager {
  private readonly queue: number[] = []
  private readonly sourceByJob = new Map<number, number>()
  private running: { jobId: number; sourceId: number; cancelled: boolean } | null = null
  private pumping: Promise<void> | null = null
  private closed = false
  private lastProgressAt = 0
  private readonly idleWaiters: (() => void)[] = []

  constructor(private readonly deps: ScanManagerDeps) {}

  get ffprobeAvailable(): boolean {
    return this.deps.probe !== null
  }

  get scanning(): boolean {
    return this.running !== null || this.queue.length > 0
  }

  status(): LibraryStatus {
    return { ffprobeAvailable: this.ffprobeAvailable, fileCount: this.deps.files.countAvailable(), scanning: this.scanning }
  }

  /** Marks scans that were cut off by a restart as failed, and returns the sources that should be scanned again. */
  recoverInterrupted(): number[] {
    const sources = this.deps.jobs.failInterrupted((this.deps.now ?? (() => new Date()))().toISOString())
    if (sources.length > 0) this.deps.logger.warn({ sources }, 'Marked interrupted scans as failed')
    return sources
  }

  /** Queues a scan unless one is already queued or running for that folder (that job is returned instead). */
  enqueue(sourceId: number, reason: string): ScanJob | null {
    if (this.closed || !this.deps.library.get(sourceId)) return null
    for (const [jobId, sid] of this.sourceByJob) {
      if (sid === sourceId) return this.deps.jobs.get(jobId)
    }
    const job = this.deps.jobs.create(sourceId)
    this.sourceByJob.set(job.id, sourceId)
    this.queue.push(job.id)
    this.deps.logger.info({ jobId: job.id, sourceId, reason }, 'Scan queued')
    void this.pump()
    return job
  }

  cancel(jobId: number): boolean {
    if (this.running?.jobId === jobId) {
      this.running.cancelled = true
      return true
    }
    const i = this.queue.indexOf(jobId)
    if (i < 0) return false
    this.queue.splice(i, 1)
    const sourceId = this.sourceByJob.get(jobId)
    this.sourceByJob.delete(jobId)
    const job = this.deps.jobs.finish(jobId, 'cancelled', this.iso(), emptySummary(), ['Cancelled before it started.'])
    if (sourceId !== undefined) this.deps.emit({ type: 'scan.finished', job })
    return true
  }

  /** Stops and forgets everything for a folder (it was removed from Theama). */
  cancelForSource(sourceId: number): void {
    if (this.running?.sourceId === sourceId) this.running.cancelled = true
    for (const [jobId, sid] of [...this.sourceByJob]) {
      if (sid === sourceId && this.running?.jobId !== jobId) {
        const i = this.queue.indexOf(jobId)
        if (i >= 0) this.queue.splice(i, 1)
        this.sourceByJob.delete(jobId)
      }
    }
  }

  /** Resolves when nothing is queued or running (used by tests and graceful shutdown). */
  whenIdle(): Promise<void> {
    if (!this.scanning && !this.pumping) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  async close(): Promise<void> {
    this.closed = true
    this.queue.length = 0
    if (this.running) this.running.cancelled = true
    await this.pumping
  }

  private iso(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString()
  }

  private pump(): Promise<void> {
    this.pumping ??= (async () => {
      try {
        while (!this.closed) {
          const jobId = this.queue.shift()
          if (jobId === undefined) break
          await this.runJob(jobId)
        }
      } finally {
        this.pumping = null
        if (!this.scanning) for (const w of this.idleWaiters.splice(0)) w()
      }
    })()
    return this.pumping
  }

  private async runJob(jobId: number): Promise<void> {
    const { deps } = this
    const sourceId = this.sourceByJob.get(jobId)
    const source = sourceId === undefined ? null : deps.library.get(sourceId)
    this.sourceByJob.delete(jobId)
    if (!source) {
      // The folder was removed while the job waited; its rows are gone with it.
      return
    }

    const state = { jobId, sourceId: source.id, cancelled: false }
    this.running = state
    deps.jobs.setRunning(jobId, this.iso())
    deps.emit({ type: 'scan.started', job: deps.jobs.get(jobId)! })
    deps.logger.info({ jobId, sourceId: source.id, path: source.path }, 'Scan started')
    const started = Date.now()

    const nestedRoots = deps.library
      .list()
      .filter((s) => s.id !== source.id && s.enabled && pathKey(s.path).startsWith(pathKey(source.path).replace(/\\$/, '') + '\\'))
      .map((s) => s.path)

    let outcome: ScanOutcome
    try {
      outcome = await (deps.scan ?? runScan)({
        source,
        nestedRoots,
        files: deps.files,
        probe: deps.probe,
        probeConcurrency: deps.probeConcurrency ?? Math.max(1, Math.min(4, cpus().length - 1)),
        isCancelled: () => state.cancelled || this.closed,
        checkOnline: async () => (await checkAvailability(source.path, source.volumeId)).availability === 'online',
        progress: (p) => this.publishProgress({ jobId, sourceId: source.id, ...p }),
        now: deps.now,
      })
    } catch (err) {
      deps.logger.error({ err, jobId }, 'Scan failed')
      outcome = { status: 'failed', summary: emptySummary(), diagnostics: [err instanceof Error ? err.message : String(err)] }
    }

    // The folder may have been removed during the scan; then there is nothing to record.
    if (!deps.library.get(source.id)) {
      this.running = null
      return
    }
    const job = deps.jobs.finish(jobId, outcome.status, this.iso(), outcome.summary, outcome.diagnostics)
    this.running = null
    deps.logger.info({ jobId, sourceId: source.id, status: outcome.status, ms: Date.now() - started, summary: outcome.summary }, 'Scan finished')
    deps.emit({ type: 'scan.finished', job })
    deps.emit({ type: 'library.changed' })
  }

  private publishProgress(p: ScanProgress): void {
    const t = Date.now()
    const interval = this.deps.progressIntervalMs ?? 400
    // Always deliver phase changes' first/last events promptly; throttle the steady stream.
    if (t - this.lastProgressAt < interval && p.probed < p.toProbe) return
    this.lastProgressAt = t
    this.deps.emit({ type: 'scan.progress', progress: p })
  }
}

function emptySummary() {
  return { found: 0, new: 0, changed: 0, moved: 0, missing: 0, skipped: 0, probed: 0, errors: 0 }
}
