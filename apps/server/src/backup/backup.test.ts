import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import pino from 'pino'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '../db/migrations'
import { openDatabase, type DbHandle } from '../db/client'
import { applyPendingRestore, backupBeforeMigration, BackupProblem, BackupService, inspectDatabase } from './backup'

const log = pino({ level: 'silent' })
const root = mkdtempSync(join(tmpdir(), 'theama-backup-'))
afterAll(() => rm(root, { recursive: true, force: true }))

let n = 0
const fresh = (): string => {
  const dir = join(root, `t${++n}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function library(handle: DbHandle, titles: string[]): void {
  handle.raw.prepare("INSERT INTO library_source (path, library_type, recursive, enabled, availability, created_at) VALUES ('D:\\M', 'auto', 1, 1, 'online', 'x')").run()
  const insert = handle.raw.prepare(
    "INSERT INTO media_file (source_id, path, size, mtime_ms, first_seen_at, last_seen_at, kind, guessed_title, title_key) VALUES (1, ?, 1, 1, 'x', 'x', 'movie', ?, ?)",
  )
  titles.forEach((t, i) => insert.run(`D:\\M\\${i}.mkv`, t, `movie:${t.toLowerCase()}:`))
}

/** A database as an older Theama left it: only the first `version` migrations applied. */
function oldDatabase(file: string, version: number): void {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  for (let v = 0; v < version; v++) db.exec(MIGRATIONS[v]!)
  db.pragma(`user_version = ${version}`)
  db.close()
}

describe('inspectDatabase', () => {
  it('describes a good backup', () => {
    const dir = fresh()
    const h = openDatabase(join(dir, 'a.db'))
    library(h, ['Alpha', 'Beta'])
    h.close()
    expect(inspectDatabase(join(dir, 'a.db'))).toEqual({ schemaVersion: LATEST_SCHEMA_VERSION, files: 2, titles: 2, collections: 0 })
  })

  it('refuses files that are not Theama backups, with a reason', () => {
    const dir = fresh()
    writeFileSync(join(dir, 'text.db'), 'this is not a database at all')
    expect(() => inspectDatabase(join(dir, 'text.db'))).toThrow(/not a Theama backup/)
    const other = new Database(join(dir, 'other.db'))
    other.exec('CREATE TABLE t (x)')
    other.pragma('user_version = 3')
    other.close()
    expect(() => inspectDatabase(join(dir, 'other.db'))).toThrow(/not a Theama backup/)
    const empty = new Database(join(dir, 'empty.db'))
    empty.close()
    expect(() => inspectDatabase(join(dir, 'empty.db'))).toThrow(/not a Theama backup/)
    expect(() => inspectDatabase(join(dir, 'missing.db'))).toThrow(BackupProblem)
    expect(() => inspectDatabase('relative.db')).toThrow(/does not exist/)
    expect(() => inspectDatabase(dir)).toThrow(BackupProblem)
  })

  it('refuses a backup from a newer Theama, so it is never half-understood', () => {
    const dir = fresh()
    const h = openDatabase(join(dir, 'newer.db'))
    h.raw.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    h.close()
    expect(() => inspectDatabase(join(dir, 'newer.db'))).toThrow(/newer Theama/)
  })
})

describe('BackupService', () => {
  let handle: DbHandle
  let dir: string
  let clock: Date
  let service: BackupService

  beforeEach(() => {
    dir = fresh()
    handle = openDatabase(join(dir, 'theama.db'))
    library(handle, ['Alpha'])
    clock = new Date('2025-03-01T10:00:00.000Z')
    service = new BackupService({ raw: handle.raw, dir: join(dir, 'backups'), restoreDir: join(dir, 'restore'), logger: log, now: () => clock })
    return () => {
      service.stop()
      handle.close()
    }
  })

  it('makes a consistent copy of a database that is in use, and lists it', () => {
    const made = service.create('manual')
    expect(made).toMatchObject({ kind: 'manual', createdAt: '2025-03-01T10:00:00.000Z', schemaVersion: LATEST_SCHEMA_VERSION })
    expect(made.name).toBe(`theama-manual-20250301-100000-v${LATEST_SCHEMA_VERSION}.db`)
    expect(made.size).toBeGreaterThan(1000)
    expect(inspectDatabase(join(dir, 'backups', made.name)).files).toBe(1)
    expect(service.list().map((b) => b.name)).toEqual([made.name])
    expect(readdirSync(join(dir, 'backups'))).toEqual([made.name]) // no partial files left behind
  })

  it('lists newest first and ignores files that are not backups', () => {
    service.create('manual')
    clock = new Date('2025-03-02T10:00:00.000Z')
    service.create('daily')
    writeFileSync(join(dir, 'backups', 'notes.txt'), 'x')
    writeFileSync(join(dir, 'backups', 'theama-manual-garbage.db'), 'x')
    expect(service.list().map((b) => b.kind)).toEqual(['daily', 'manual'])
  })

  it('makes a daily backup only when none is recent, and keeps only the last seven', () => {
    expect(service.ensureDaily()).not.toBeNull()
    clock = new Date(clock.getTime() + 60 * 60 * 1000)
    expect(service.ensureDaily()).toBeNull() // an hour later: nothing new
    for (let day = 1; day <= 10; day++) {
      clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000)
      expect(service.ensureDaily()).not.toBeNull()
    }
    expect(service.list().filter((b) => b.kind === 'daily')).toHaveLength(7)
  })

  it('never deletes manual backups on its own, and a manual one counts as a recent backup', () => {
    for (let i = 0; i < 12; i++) {
      clock = new Date(clock.getTime() + 1000)
      service.create('manual')
    }
    expect(service.list().filter((b) => b.kind === 'manual')).toHaveLength(12)
    expect(service.ensureDaily()).toBeNull()
  })

  it('removes a named backup, and only a real one', () => {
    const b = service.create('manual')
    service.remove(b.name)
    expect(service.list()).toEqual([])
    expect(() => service.remove(b.name)).toThrow(BackupProblem)
    expect(() => service.remove('..\\..\\theama.db')).toThrow(BackupProblem)
  })

  it('stages a restore from a listed backup or an outside file, without touching the running database', () => {
    const b = service.create('manual')
    handle.raw.prepare("UPDATE media_file SET guessed_title = 'Changed'").run()
    const staged = service.stage({ name: b.name })
    expect(staged).toMatchObject({ source: b.name, schemaVersion: LATEST_SCHEMA_VERSION, summary: { files: 1, titles: 1 } })
    expect(service.pending()?.source).toBe(b.name)
    expect((handle.raw.prepare('SELECT guessed_title AS t FROM media_file').get() as { t: string }).t).toBe('Changed')

    service.cancelPending()
    expect(service.pending()).toBeNull()
    expect(service.stage({ path: join(dir, 'backups', b.name) }).source).toBe(b.name)
    expect(() => service.stage({ name: 'nope.db' })).toThrow(/No such backup/)
    writeFileSync(join(dir, 'junk.db'), 'junk')
    expect(() => service.stage({ path: join(dir, 'junk.db') })).toThrow(/not a Theama backup/)
  })
})

describe('restoring at start-up', () => {
  it('replaces the database from the staged backup, keeping the old one as a pre-restore backup', () => {
    const dir = fresh()
    const paths = { databaseFile: join(dir, 'data', 'theama.db'), backupsDir: join(dir, 'backups'), restoreDir: join(dir, 'restore') }
    const h = openDatabase(paths.databaseFile)
    library(h, ['Original'])
    const service = new BackupService({ raw: h.raw, dir: paths.backupsDir, restoreDir: paths.restoreDir, logger: log })
    const backup = service.create('manual')
    h.raw.prepare("UPDATE media_file SET guessed_title = 'Newer'").run()
    service.stage({ name: backup.name })
    h.close()

    expect(applyPendingRestore(paths, log, new Date('2025-04-01T00:00:00.000Z'))).toBe(true)

    const back = openDatabase(paths.databaseFile)
    expect((back.raw.prepare('SELECT guessed_title AS t FROM media_file').get() as { t: string }).t).toBe('Original')
    back.close()
    const kept = readdirSync(paths.backupsDir).find((n) => n.includes('pre-restore'))!
    expect(kept).toBeDefined()
    const old = new Database(join(paths.backupsDir, kept), { readonly: true })
    expect((old.prepare('SELECT guessed_title AS t FROM media_file').get() as { t: string }).t).toBe('Newer')
    old.close()
    expect(existsSync(join(paths.restoreDir, 'pending.db'))).toBe(false)
    expect(applyPendingRestore(paths, log)).toBe(false) // nothing left to apply
  })

  it('drops a staged file that stopped being a valid backup, and leaves the current database alone', () => {
    const dir = fresh()
    const paths = { databaseFile: join(dir, 'data', 'theama.db'), backupsDir: join(dir, 'backups'), restoreDir: join(dir, 'restore') }
    const h = openDatabase(paths.databaseFile)
    library(h, ['Keep me'])
    h.close()
    mkdirSync(paths.restoreDir, { recursive: true })
    writeFileSync(join(paths.restoreDir, 'pending.db'), 'damaged in the meantime')
    expect(applyPendingRestore(paths, log)).toBe(false)
    expect(existsSync(join(paths.restoreDir, 'pending.db'))).toBe(false)
    const still = openDatabase(paths.databaseFile)
    expect((still.raw.prepare('SELECT guessed_title AS t FROM media_file').get() as { t: string }).t).toBe('Keep me')
    still.close()
  })

  it('restores onto a fresh install (no database yet)', () => {
    const dir = fresh()
    const src = openDatabase(join(dir, 'src.db'))
    library(src, ['Imported'])
    src.close()
    const paths = { databaseFile: join(dir, 'data', 'theama.db'), backupsDir: join(dir, 'backups'), restoreDir: join(dir, 'restore') }
    mkdirSync(paths.restoreDir, { recursive: true })
    const h = openDatabase(join(dir, 'tmp.db'))
    const service = new BackupService({ raw: h.raw, dir: join(dir, 'b'), restoreDir: paths.restoreDir, logger: log })
    service.stage({ path: join(dir, 'src.db') })
    h.close()
    mkdirSync(join(dir, 'data'), { recursive: true })
    expect(applyPendingRestore(paths, log)).toBe(true)
    const back = openDatabase(paths.databaseFile)
    expect((back.raw.prepare('SELECT guessed_title AS t FROM media_file').get() as { t: string }).t).toBe('Imported')
    back.close()
  })

  it('an older backup is migrated forward when it is opened', () => {
    const dir = fresh()
    const old = join(dir, 'old.db')
    oldDatabase(old, 3)
    const paths = { databaseFile: join(dir, 'data', 'theama.db'), backupsDir: join(dir, 'backups'), restoreDir: join(dir, 'restore') }
    mkdirSync(paths.restoreDir, { recursive: true })
    const h = openDatabase(join(dir, 'tmp.db'))
    new BackupService({ raw: h.raw, dir: join(dir, 'b'), restoreDir: paths.restoreDir, logger: log }).stage({ path: old })
    h.close()
    expect(applyPendingRestore(paths, log)).toBe(true)
    const back = openDatabase(paths.databaseFile)
    expect(back.appliedMigrations).toEqual(Array.from({ length: LATEST_SCHEMA_VERSION - 3 }, (_, i) => i + 4))
    back.close()
  })
})

describe('backing up before an upgrade', () => {
  it('copies a database that is about to be migrated, and does nothing for a current or new one', () => {
    const dir = fresh()
    const file = join(dir, 'data', 'theama.db')
    mkdirSync(join(dir, 'data'))
    expect(backupBeforeMigration(file, join(dir, 'backups'), log)).toBeNull() // no database yet

    oldDatabase(file, 4)
    const made = backupBeforeMigration(file, join(dir, 'backups'), log, new Date('2025-05-05T05:05:05.000Z'))!
    expect(made).toContain('theama-pre-migration-20250505-050505-v4.db')
    expect(inspectDatabase(made).schemaVersion).toBe(4)

    openDatabase(file).close() // migrates to the latest
    expect(backupBeforeMigration(file, join(dir, 'backups'), log)).toBeNull() // already current
  })
})
