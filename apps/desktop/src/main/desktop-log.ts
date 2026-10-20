import { RotatingNdjsonWriter } from '@theama/logs'

const LEVELS = { error: 50, fatal: 60, warn: 40, info: 30 } as const

let writer: RotatingNdjsonWriter | null = null
let writerDir = ''

/**
 * Writes one line to the shared log history in the same shape the service uses, tagged `source: "desktop"`.
 * Logging must never be the thing that breaks the app, so any failure here is swallowed.
 */
export function logDesktop(logsDir: string, level: keyof typeof LEVELS, msg: string, context: Record<string, unknown> = {}): void {
  try {
    if (!writer || writerDir !== logsDir) {
      writer = new RotatingNdjsonWriter(logsDir)
      writerDir = logsDir
    }
    writer.write(JSON.stringify({ level: LEVELS[level], time: new Date().toISOString(), pid: process.pid, source: 'desktop', ...context, msg }))
  } catch {
    // nothing sensible to do
  }
}
