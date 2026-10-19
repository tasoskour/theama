import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export const LOG_FILE_PATTERN = /^theama-(\d{4}-\d{2}-\d{2})-(\d{3})\.ndjson$/
const MAX_FILE_BYTES = 10 * 1024 * 1024

export function logFileName(day: string, index: number): string {
  return `theama-${day}-${String(index).padStart(3, '0')}.ndjson`
}

/** Lists app log files, newest first (names sort lexicographically by date then index). */
export function listLogFiles(logsDir: string): string[] {
  if (!existsSync(logsDir)) return []
  return readdirSync(logsDir)
    .filter((f) => LOG_FILE_PATTERN.test(f))
    .sort()
    .reverse()
}

/**
 * Appends NDJSON lines to a daily log file, rolling to a new numbered file at
 * 10 MB. Writes are synchronous: log volume is low and this keeps the last
 * line on disk if the process dies.
 */
export class RotatingNdjsonWriter {
  private day = ''
  private index = 0
  private size = 0

  constructor(
    private readonly logsDir: string,
    private readonly now: () => Date = () => new Date(),
    private readonly maxBytes = MAX_FILE_BYTES,
  ) {
    mkdirSync(logsDir, { recursive: true })
  }

  write(line: string): void {
    const text = line.endsWith('\n') ? line : `${line}\n`
    this.ensureTarget(Buffer.byteLength(text))
    appendFileSync(join(this.logsDir, logFileName(this.day, this.index)), text, 'utf8')
    this.size += Buffer.byteLength(text)
  }

  private ensureTarget(incoming: number): void {
    const day = this.now().toISOString().slice(0, 10)
    if (day !== this.day) {
      this.day = day
      this.index = this.highestIndexFor(day)
      this.size = this.sizeOf(this.index)
    }
    if (this.size > 0 && this.size + incoming > this.maxBytes) {
      this.index += 1
      this.size = 0
    }
  }

  private highestIndexFor(day: string): number {
    let highest = 1
    for (const f of readdirSync(this.logsDir)) {
      const m = LOG_FILE_PATTERN.exec(f)
      if (m && m[1] === day) highest = Math.max(highest, Number(m[2]))
    }
    return highest
  }

  private sizeOf(index: number): number {
    try {
      return statSync(join(this.logsDir, logFileName(this.day, index))).size
    } catch {
      return 0
    }
  }
}

/** Deletes app log files older than `retentionDays`. Returns the removed names. */
export function pruneLogs(logsDir: string, retentionDays: number, now: Date = new Date()): string[] {
  const cutoff = now.getTime() - retentionDays * 86_400_000
  const removed: string[] = []
  for (const f of listLogFiles(logsDir)) {
    const m = LOG_FILE_PATTERN.exec(f)
    if (!m) continue
    const fileDay = Date.parse(`${m[1]}T23:59:59Z`)
    if (fileDay < cutoff) {
      try {
        unlinkSync(join(logsDir, f))
        removed.push(f)
      } catch {
        // A locked file is simply kept until the next prune.
      }
    }
  }
  return removed
}
