import { parentPort } from 'node:worker_threads'
import { readAppLogs } from '@theama/logs'
import type { LogQuery } from '@theama/contracts'
import { inspectDatabase } from '../backup/backup'
import Database from 'better-sqlite3'

parentPort!.on('message', async (message: { id: number; task: 'logs'; directory: string; query: LogQuery } | { id: number; task: 'inspect' | 'finalize'; file: string } | { id: number; task: 'snapshot'; file: string; target: string }) => {
  try {
    let value: unknown
    if (message.task === 'snapshot') {
      const db = new Database(message.file, { readonly: true, fileMustExist: true })
      try { await db.backup(message.target) } finally { db.close() }
    } else if (message.task === 'finalize') {
      const db = new Database(message.file, { fileMustExist: true })
      try { db.pragma('journal_mode = DELETE') } finally { db.close() }
    } else value = message.task === 'logs' ? readAppLogs(message.directory, message.query) : inspectDatabase(message.file)
    parentPort!.postMessage({ id: message.id, value })
  } catch (err) {
    const error = err as Error & { code?: string }
    parentPort!.postMessage({ id: message.id, error: { message: error.message, code: error.code } })
  }
})
