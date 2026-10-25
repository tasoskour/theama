import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { LogPage, LogQuery } from '@theama/contracts'
import type { BackupSummary } from '../backup/backup'

/** One lazy worker for disk-heavy reads. A failed worker is replaced on the next request. */
export class BackgroundReader {
  private worker: Worker | null = null
  private nextId = 0
  private closed = false
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>()

  logs(directory: string, query: LogQuery): Promise<LogPage> {
    return this.request({ task: 'logs', directory, query }) as Promise<LogPage>
  }

  inspect(file: string): Promise<BackupSummary> {
    return this.request({ task: 'inspect', file }) as Promise<BackupSummary>
  }

  async prepareBackup(file: string): Promise<void> {
    await this.request({ task: 'finalize', file })
  }

  async snapshot(file: string, target: string): Promise<void> {
    await this.request({ task: 'snapshot', file, target })
  }

  private request(task: object): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Background reader is closed'))
    if (!this.worker) this.start()
    const worker = this.worker!
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.ref()
      worker.postMessage({ ...task, id })
    })
  }

  private start(): void {
    // esbuild places the packaged worker beside server.cjs. Source runs use tsx's CJS loader.
    const here = typeof __dirname === 'string' ? __dirname : import.meta.dirname
    const bundle = join(here, 'background-worker.cjs')
    const worker = existsSync(bundle)
      ? new Worker(bundle)
      : new Worker(`require('tsx/cjs/api').require(${JSON.stringify(join(here, 'worker.ts'))}, ${JSON.stringify(join(here, 'loader.cjs'))})`, { eval: true })
    this.worker = worker
    worker.on('message', (message: { id: number; value?: unknown; error?: { message: string; code?: string } }) => {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.error) request.reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
      else request.resolve(message.value)
      if (this.pending.size === 0) worker.unref()
    })
    const fail = (err: Error): void => {
      if (this.worker !== worker) return
      this.worker = null
      for (const request of this.pending.values()) request.reject(err)
      this.pending.clear()
    }
    worker.on('error', fail)
    worker.on('exit', code => fail(new Error(`Background reader exited (${code})`)))
    worker.unref()
  }

  async close(): Promise<void> {
    this.closed = true
    const worker = this.worker
    this.worker = null
    for (const request of this.pending.values()) request.reject(new Error('Background reader is closed'))
    this.pending.clear()
    await worker?.terminate()
  }
}
