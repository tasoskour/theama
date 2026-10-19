import { watch as fsWatch, type FSWatcher } from 'node:fs'
import type { Logger } from 'pino'
import type { LibrarySource, SourceAvailability } from '@theama/contracts'
import { LibrarySourceRepo, refreshAvailability } from '../library/sources'
import type { ScanManager } from './manager'

export interface AutoScanDeps {
  library: LibrarySourceRepo
  manager: ScanManager
  logger: Logger
  /** How often folders are re-checked for coming back online. */
  pollMs?: number
  /** Safety-net rescan interval (file watchers are unreliable on network shares). */
  periodicMs?: number
  /** Quiet time after the last file-system event before a rescan is queued. */
  debounceMs?: number
  watch?: typeof fsWatch
  refresh?: (repo: LibrarySourceRepo) => Promise<LibrarySource[]>
  now?: () => number
}

interface Watched {
  watcher: FSWatcher
  path: string
  recursive: boolean
  timer?: NodeJS.Timeout
}

/**
 * Decides *when* to scan: at service start, when a drive comes back, after file
 * changes (debounced), and now and then as a safety net. Removing or disabling a
 * folder stops its watcher.
 */
export class AutoScanner {
  private readonly watched = new Map<number, Watched>()
  private readonly lastQueued = new Map<number, number>()
  private availability = new Map<number, SourceAvailability>()
  private timer: NodeJS.Timeout | null = null
  private ticking: Promise<void> | null = null

  constructor(private readonly deps: AutoScanDeps) {}

  start(): void {
    const now = this.now()
    this.availability = new Map(this.deps.library.list().map((s) => [s.id, s.availability]))
    for (const s of this.deps.library.list()) {
      if (s.enabled) this.queue(s, 'service start', now)
    }
    this.timer = setInterval(() => void this.tick(), this.deps.pollMs ?? 60_000)
    this.timer.unref()
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const id of [...this.watched.keys()]) this.unwatch(id)
  }

  /** One poll: re-check availability, queue scans for folders that came back or are due, and (re)attach watchers. */
  tick(): Promise<void> {
    this.ticking ??= (async () => {
      try {
        const previous = this.availability
        const refreshed = await (this.deps.refresh ?? refreshAvailability)(this.deps.library)
        const now = this.now()
        this.availability = new Map(refreshed.map((s) => [s.id, s.availability]))
        for (const s of refreshed) {
          if (!s.enabled || s.availability !== 'online') continue
          if (previous.get(s.id) === 'offline') this.queue(s, 'folder is back online', now)
          else if (now - (this.lastQueued.get(s.id) ?? 0) > (this.deps.periodicMs ?? 6 * 3_600_000)) this.queue(s, 'periodic check', now)
        }
        this.syncWatchers(refreshed)
      } catch (err) {
        this.deps.logger.warn({ err }, 'Folder availability check failed')
      } finally {
        this.ticking = null
      }
    })()
    return this.ticking
  }

  /** Call after folders were added, changed or removed. */
  syncWatchers(sources: LibrarySource[] = this.deps.library.list()): void {
    const wanted = new Map(sources.filter((s) => s.enabled && s.availability === 'online').map((s) => [s.id, s]))
    for (const id of [...this.watched.keys()]) {
      const w = this.watched.get(id)!
      const s = wanted.get(id)
      if (!s || s.path !== w.path || s.recursive !== w.recursive) this.unwatch(id)
    }
    for (const s of wanted.values()) if (!this.watched.has(s.id)) this.watch(s)
  }

  get watchedCount(): number {
    return this.watched.size
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private queue(source: LibrarySource, reason: string, now: number): void {
    this.lastQueued.set(source.id, now)
    this.deps.manager.enqueue(source.id, reason)
  }

  private watch(source: LibrarySource): void {
    try {
      const watcher = (this.deps.watch ?? fsWatch)(source.path, { recursive: source.recursive, persistent: false }, () => {
        const entry = this.watched.get(source.id)
        if (!entry) return
        clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          this.queue(source, 'files changed', this.now())
        }, this.deps.debounceMs ?? 2000)
      })
      // A removed drive or an inaccessible folder raises an error on the watcher: drop it, the next poll re-attaches.
      watcher.on('error', (err) => {
        this.deps.logger.warn({ err, sourceId: source.id }, 'Folder watcher stopped')
        this.unwatch(source.id)
      })
      this.watched.set(source.id, { watcher, path: source.path, recursive: source.recursive })
    } catch (err) {
      this.deps.logger.warn({ err, sourceId: source.id }, 'Could not watch folder; relying on periodic scans')
    }
  }

  private unwatch(sourceId: number): void {
    const w = this.watched.get(sourceId)
    if (!w) return
    clearTimeout(w.timer)
    try {
      w.watcher.close()
    } catch {
      // already closed
    }
    this.watched.delete(sourceId)
  }
}
