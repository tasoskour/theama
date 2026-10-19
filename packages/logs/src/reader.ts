import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import {
  LOG_LEVEL_ORDER,
  type LogEntry,
  type LogLevel,
  type LogPage,
  type LogQuery,
  type LogSource,
} from '@theama/contracts'
import { pinoLineToEntry } from './entries'
import { listLogFiles } from './file-writer'

export const SERVICE_STDOUT_FILE = 'service-stdout.log'
export const SERVICE_STDERR_FILE = 'service-stderr.log'

const TAIL_BYTES = 256 * 1024

function levelAtLeast(level: LogLevel, min: LogLevel | undefined): boolean {
  if (!min) return true
  return LOG_LEVEL_ORDER.indexOf(level) >= LOG_LEVEL_ORDER.indexOf(min)
}

function matches(entry: LogEntry, q: Omit<LogQuery, 'limit' | 'cursor'>): boolean {
  if (!levelAtLeast(entry.level, q.level)) return false
  if (q.source && entry.source !== q.source) return false
  const t = Date.parse(entry.time)
  if (q.from && t < Date.parse(q.from)) return false
  if (q.to && t > Date.parse(q.to)) return false
  if (q.q && !entry.message.toLowerCase().includes(q.q.toLowerCase())) return false
  return true
}

interface Cursor {
  file: string
  /** Index of the last line already returned; the next page starts before it. */
  line: number
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url')
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor
    return typeof c.file === 'string' && Number.isInteger(c.line) ? c : null
  } catch {
    return null
  }
}

/**
 * Pages through the rotated NDJSON app logs, newest first. Cursor-based so the
 * history stays stable while new lines are appended at the end of today's file.
 */
export function readAppLogs(logsDir: string, query: LogQuery): LogPage {
  const files = listLogFiles(logsDir)
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  let fileIdx = cursor ? files.indexOf(cursor.file) : 0
  if (fileIdx < 0) fileIdx = 0
  const items: LogEntry[] = []

  for (; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx]!
    const lines = readFileSync(join(logsDir, file), 'utf8').split('\n')
    let start = lines.length - 1
    if (cursor && cursor.file === file) start = Math.min(start, cursor.line - 1)
    for (let i = start; i >= 0; i--) {
      const entry = pinoLineToEntry(lines[i] ?? '', 'app', `app:${file}:${i}`)
      if (!entry || !matches(entry, query)) continue
      items.push(entry)
      if (items.length >= query.limit) {
        return { items, nextCursor: encodeCursor({ file, line: i }) }
      }
    }
  }
  return { items, nextCursor: null }
}

function readTail(path: string, maxBytes: number): string {
  const { size } = statSync(path)
  const length = Math.min(size, maxBytes)
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(length)
    readSync(fd, buf, 0, length, size - length)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/**
 * Reads the tail of an NSSM-captured stdout/stderr file. These lines have no
 * timestamps of their own, so entries carry the file's modification time.
 */
export function readServiceOutput(
  logsDir: string,
  source: Extract<LogSource, 'service-stdout' | 'service-stderr'>,
  query: Pick<LogQuery, 'limit' | 'q' | 'level'>,
): LogEntry[] {
  const file = source === 'service-stdout' ? SERVICE_STDOUT_FILE : SERVICE_STDERR_FILE
  const path = join(logsDir, file)
  if (!existsSync(path)) return []
  const time = statSync(path).mtime.toISOString()
  const level: LogLevel = source === 'service-stderr' ? 'error' : 'info'
  if (!levelAtLeast(level, query.level)) return []
  const lines = readTail(path, TAIL_BYTES)
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
  const out: LogEntry[] = []
  for (let i = lines.length - 1; i >= 0 && out.length < query.limit; i--) {
    const message = lines[i]!
    if (query.q && !message.toLowerCase().includes(query.q.toLowerCase())) continue
    out.push({ id: `${source}:${file}:${i}`, time, level, source, message })
  }
  return out
}

/** Convenience used by the desktop shell when the service is unreachable. */
export function readRecentLocal(logsDir: string, limit: number): LogEntry[] {
  const page = readAppLogs(logsDir, { limit } as LogQuery)
  const stderr = readServiceOutput(logsDir, 'service-stderr', { limit: 20 })
  return [...stderr, ...page.items].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, limit)
}
