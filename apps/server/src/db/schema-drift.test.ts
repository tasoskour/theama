import { getTableName, is } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { openDatabase } from './client'
import * as schema from './schema'

/**
 * Migrations are hand-written SQL; the Drizzle schema is what queries use.
 * This keeps the two from drifting apart: every Drizzle column must exist in
 * the migrated database with the same name, nullability and primary-key flag.
 */
describe('drizzle schema matches the migrated database', () => {
  const { raw } = openDatabase(':memory:')
  const tables = (Object.values(schema) as unknown[]).filter((v) => is(v, SQLiteTable)) as SQLiteTable[]

  it('declares every table', () => {
    // The FTS5 index and its shadow tables are created by SQL only; Drizzle never queries them.
    const inDb = (raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'media_file_fts%'").all() as { name: string }[])
      .map((t) => t.name)
      .sort()
    expect(tables.map(getTableName).sort()).toEqual(inDb)
  })

  for (const table of tables) {
    const config = getTableConfig(table)
    it(`${config.name} columns line up`, () => {
      const info = raw.prepare(`PRAGMA table_info(${config.name})`).all() as {
        name: string
        notnull: number
        pk: number
      }[]
      const byName = new Map(info.map((c) => [c.name, c]))
      expect([...byName.keys()].sort()).toEqual(config.columns.map((c) => c.name).sort())
      const compositeKey = new Set(config.primaryKeys.flatMap((k) => k.columns.map((c) => c.name)))
      for (const col of config.columns) {
        const dbCol = byName.get(col.name)!
        const isKey = col.primary || compositeKey.has(col.name)
        expect(Boolean(dbCol.pk), `${config.name}.${col.name} primary key`).toBe(isKey)
        if (!isKey) expect(Boolean(dbCol.notnull), `${config.name}.${col.name} not null`).toBe(col.notNull)
      }
    })
  }
})
