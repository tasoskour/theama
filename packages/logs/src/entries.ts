import { LogEntry, type LogLevel, type LogSource } from '@theama/contracts'

const PINO_LEVELS: Record<number, LogLevel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

const IGNORED_KEYS = new Set(['level', 'time', 'msg', 'pid', 'hostname'])

/** Converts one pino NDJSON line into a LogEntry, or null if it is not a log record. */
export function pinoLineToEntry(line: string, source: LogSource, id: string): LogEntry | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  const level = typeof raw.level === 'number' ? PINO_LEVELS[raw.level] : undefined
  const time = typeof raw.time === 'string' ? raw.time : undefined
  if (!level || !time || Number.isNaN(Date.parse(time))) return null
  const context: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) if (!IGNORED_KEYS.has(k)) context[k] = v
  const entry = {
    id,
    time: new Date(time).toISOString(),
    level,
    source,
    message: typeof raw.msg === 'string' ? raw.msg : '',
    ...(Object.keys(context).length > 0 ? { context } : {}),
  }
  const parsed = LogEntry.safeParse(entry)
  return parsed.success ? parsed.data : null
}
