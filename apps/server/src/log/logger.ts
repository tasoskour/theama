import pino, { type Logger } from 'pino'
import type { ServerConfig } from '../config'
import { RotatingNdjsonWriter } from '@theama/logs'
import { LogHub } from './hub'

export interface LoggerBundle {
  logger: Logger
  hub: LogHub
  writer: RotatingNdjsonWriter
}

const LEVEL_LABELS: Record<number, string> = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO ', 40: 'WARN ', 50: 'ERROR', 60: 'FATAL' }

/**
 * App logger: NDJSON files (the log history), an in-memory ring for live tail,
 * and, in foreground mode only, human readable stdout. Under the service host
 * stdout/stderr belong to NSSM and carry process-level output such as crashes.
 */
export function createLogger(config: Pick<ServerConfig, 'logsDir' | 'logLevel' | 'hostMode'>): LoggerBundle {
  const writer = new RotatingNdjsonWriter(config.logsDir)
  const hub = new LogHub()
  const streams: pino.StreamEntry[] = [
    { level: 'trace', stream: { write: (line: string) => writer.write(line) } },
    { level: 'trace', stream: hub.stream },
  ]
  if (config.hostMode === 'foreground') {
    streams.push({
      level: 'trace',
      stream: {
        write: (line: string) => {
          try {
            const r = JSON.parse(line) as { level: number; time: string; msg?: string }
            process.stdout.write(`${r.time} ${LEVEL_LABELS[r.level] ?? r.level} ${r.msg ?? ''}\n`)
          } catch {
            process.stdout.write(line)
          }
        },
      },
    })
  }
  const logger = pino(
    { level: config.logLevel, timestamp: pino.stdTimeFunctions.isoTime, base: { pid: process.pid } },
    pino.multistream(streams),
  )
  return { logger, hub, writer }
}
