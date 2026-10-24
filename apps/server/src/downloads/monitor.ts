import type { Logger } from 'pino'
import type { DownloadItem, DownloadList } from '@theama/contracts'

export interface DownloadMonitorOptions {
  list: () => Promise<DownloadList>
  emit: (list: DownloadList) => void
  /** A download that was running has just finished. */
  onFinished: (item: DownloadItem) => void
  /** Whether a window is open to show progress, which decides how often to look. */
  watched: () => boolean
  logger: Logger
  /** How often to look while someone is watching, and while nobody is (completion still has to be noticed). */
  watchedMs?: number
  idleMs?: number
}

/**
 * Keeps an eye on qBittorrent: pushes the list to open windows whenever it changes, and notices when a download
 * finishes so the library can pick the file up. Looks every few seconds while a window is open, rarely otherwise.
 */
export class DownloadMonitor {
  private timer: NodeJS.Timeout | null = null
  private stopped = true
  private last = ''
  /** hash -> was it complete the last time we looked. A download first seen as complete is not "just finished". */
  private readonly seen = new Map<string, boolean>()

  constructor(private readonly options: DownloadMonitorOptions) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Look now (after the person added or removed something) instead of waiting for the next round. */
  nudge(): void {
    if (this.stopped) return
    this.schedule(0)
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), ms)
    this.timer.unref()
  }

  async tick(): Promise<void> {
    try {
      const list = await this.options.list()
      this.publish(list)
      if (list.reachable) this.noticeFinished(list.items)
    } catch (err) {
      this.options.logger.warn({ err }, 'Could not check the downloads')
    }
    if (!this.stopped) this.schedule(this.options.watched() ? (this.options.watchedMs ?? 3000) : (this.options.idleMs ?? 20_000))
  }

  private publish(list: DownloadList): void {
    const key = JSON.stringify(list)
    if (key === this.last) return
    this.last = key
    this.options.emit(list)
  }

  private noticeFinished(items: DownloadItem[]): void {
    const present = new Set<string>()
    for (const item of items) {
      present.add(item.hash)
      const complete = item.state === 'completed'
      if (complete && this.seen.get(item.hash) === false) {
        try {
          this.options.onFinished(item)
        } catch (err) {
          this.options.logger.warn({ err }, 'Could not react to a finished download')
        }
      }
      this.seen.set(item.hash, complete)
    }
    for (const hash of this.seen.keys()) if (!present.has(hash)) this.seen.delete(hash)
  }
}
