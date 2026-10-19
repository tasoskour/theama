import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { LATEST_SCHEMA_VERSION, migrate } from './migrations'

export type Db = BetterSQLite3Database<typeof schema>

export interface DbHandle {
  db: Db
  raw: Database.Database
  appliedMigrations: number[]
  schemaVersion: number
  close(): void
}

/** Opens (creating if needed) the SQLite database and applies migrations. Use ':memory:' in tests. */
export function openDatabase(file: string): DbHandle {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const raw = new Database(file)
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')
  raw.pragma('busy_timeout = 5000')
  raw.pragma('synchronous = NORMAL')
  const appliedMigrations = migrate(raw)
  return {
    db: drizzle(raw, { schema }),
    raw,
    appliedMigrations,
    schemaVersion: LATEST_SCHEMA_VERSION,
    close: () => raw.close(),
  }
}

export { schema }
