import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { OperationBatch, OperationItem, OperationStatus } from '@theama/contracts'

export interface PlannedOperation {
  kind: 'video' | 'subtitle'
  fileId: number | null
  from: string
  to: string
}

export interface JournalRow {
  id: number
  batchId: string
  seq: number
  kind: 'video' | 'subtitle'
  fileId: number | null
  from: string
  to: string
  status: OperationStatus
  error: string | null
}

interface Row {
  id: number
  batch_id: string
  seq: number
  kind: 'video' | 'subtitle'
  file_id: number | null
  from_path: string
  to_path: string
  status: OperationStatus
  error: string | null
  created_at: string
}

const toRow = (r: Row): JournalRow => ({ id: r.id, batchId: r.batch_id, seq: r.seq, kind: r.kind, fileId: r.file_id, from: r.from_path, to: r.to_path, status: r.status, error: r.error })

/**
 * The record of every rename. A batch is written in full as "pending" before anything on disk changes, and
 * each item is marked as it finishes, so after a crash the journal says exactly what may have happened.
 */
export class FileJournal {
  constructor(private readonly raw: Database.Database) {}

  /** Writes a batch as pending in one transaction. */
  begin(ops: readonly PlannedOperation[], now: string): { batchId: string; rows: JournalRow[] } {
    const batchId = randomUUID()
    const insert = this.raw.prepare(
      `INSERT INTO file_operation (batch_id, seq, kind, file_id, from_path, to_path, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    this.raw.transaction(() => ops.forEach((o, i) => insert.run(batchId, i, o.kind, o.fileId, o.from, o.to, now)))()
    return { batchId, rows: this.rows(batchId) }
  }

  rows(batchId: string): JournalRow[] {
    return (this.raw.prepare('SELECT * FROM file_operation WHERE batch_id = ? ORDER BY seq').all(batchId) as Row[]).map(toRow)
  }

  mark(id: number, status: OperationStatus, error: string | null, now: string): void {
    this.raw.prepare('UPDATE file_operation SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(status, error, now, id)
  }

  /** Batches that still have a pending item: the service stopped in the middle of them. */
  interruptedBatches(): string[] {
    return (this.raw.prepare("SELECT DISTINCT batch_id FROM file_operation WHERE status = 'pending'").all() as { batch_id: string }[]).map((r) => r.batch_id)
  }

  private summarise(batchId: string): OperationBatch | null {
    const rows = this.rows(batchId)
    if (rows.length === 0) return null
    const created = (this.raw.prepare('SELECT created_at FROM file_operation WHERE batch_id = ? ORDER BY seq LIMIT 1').get(batchId) as { created_at: string }).created_at
    const count = (s: OperationStatus): number => rows.filter((r) => r.status === s).length
    const items: OperationItem[] = rows.map((r) => ({ id: r.id, kind: r.kind, from: r.from, to: r.to, status: r.status, error: r.error }))
    return {
      id: batchId,
      createdAt: created,
      total: rows.length,
      done: count('done'),
      failed: count('failed') + count('rollback_failed'),
      rolledBack: count('rolled_back'),
      canRollback: count('done') > 0 || count('pending') > 0,
      items,
    }
  }

  batch(batchId: string): OperationBatch | null {
    return this.summarise(batchId)
  }

  /** Newest batches first. */
  list(limit: number): OperationBatch[] {
    const ids = (this.raw.prepare('SELECT batch_id FROM file_operation GROUP BY batch_id ORDER BY MIN(id) DESC LIMIT ?').all(limit) as { batch_id: string }[]).map((r) => r.batch_id)
    return ids.flatMap((id) => {
      const b = this.summarise(id)
      return b ? [b] : []
    })
  }
}
