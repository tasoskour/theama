import { desc } from 'drizzle-orm'
import type { ServiceEvent, ServiceEventKind } from '@theama/contracts'
import type { Db } from '../db/client'
import { serviceEvent } from '../db/schema'

export class ServiceEventRepo {
  constructor(private readonly db: Db) {}

  record(kind: ServiceEventKind, details: { reason?: string; pid?: number; version?: string } = {}): void {
    this.db
      .insert(serviceEvent)
      .values({
        time: new Date().toISOString(),
        kind,
        reason: details.reason ?? null,
        pid: details.pid ?? null,
        version: details.version ?? null,
      })
      .run()
  }

  latest(): ServiceEvent | null {
    return this.list(1)[0] ?? null
  }

  list(limit = 100): ServiceEvent[] {
    return this.db.select().from(serviceEvent).orderBy(desc(serviceEvent.id)).limit(limit).all()
  }
}

/**
 * If the previous run recorded a start but never a stop, the process died
 * without a clean shutdown; record that so the history shows the crash.
 */
export function recordCrashIfUncleanShutdown(repo: ServiceEventRepo): boolean {
  const last = repo.latest()
  if (last && (last.kind === 'start' || last.kind === 'restart' || last.kind === 'migrate')) {
    repo.record('crash', { reason: 'Previous run ended without a clean shutdown', pid: last.pid ?? undefined })
    return true
  }
  return false
}
