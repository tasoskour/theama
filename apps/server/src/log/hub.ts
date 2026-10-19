import { EventEmitter } from 'node:events'
import type { LogEntry } from '@theama/contracts'
import { pinoLineToEntry } from '@theama/logs'

const RING_SIZE = 500

/** In-memory tail of recent log lines plus a subscription point for live push. */
export class LogHub {
  private readonly ring: LogEntry[] = []
  private readonly emitter = new EventEmitter()
  private seq = 0

  /** Stream target for pino: receives one JSON line per record. */
  readonly stream = {
    write: (line: string): void => {
      const entry = pinoLineToEntry(line, 'app', `live:${this.seq++}`)
      if (!entry) return
      this.ring.push(entry)
      if (this.ring.length > RING_SIZE) this.ring.shift()
      this.emitter.emit('entry', entry)
    },
  }

  recent(limit = 100): LogEntry[] {
    return this.ring.slice(-limit)
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.emitter.on('entry', listener)
    return () => this.emitter.off('entry', listener)
  }
}
