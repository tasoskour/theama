import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import Database from 'better-sqlite3'
import type { Logger } from 'pino'
import type { BackupInfo, BackupKind, PendingRestore } from '@theama/contracts'
import { LATEST_SCHEMA_VERSION } from '../db/migrations'

/** How many of each automatic kind to keep. Manual backups are never deleted by Theama. */
const KEEP: Partial<Record<BackupKind, number>> = { daily: 7, 'pre-migration': 5, 'pre-restore': 3 }
const DAY_MS = 24 * 60 * 60 * 1000
const NAME = /^theama-(manual|daily|pre-migration|pre-restore)-(\d{8}-\d{6})-v(\d+)\.db$/

export class BackupProblem extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_backup' | 'newer_version' | 'bad_path',
    message: string,
  ) {
    super(message)
  }
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-')
const fromStamp = (s: string): string => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.000Z`

export interface BackupSummary {
  schemaVersion: number
  files: number
  titles: number
  collections: number
}

/**
 * Checks that a file is a Theama database Theama can use, without changing it: it must open as SQLite, pass
 * SQLite's quick integrity check, have the tables a library has, and not come from a newer Theama.
 */
export function inspectDatabase(file: string): BackupSummary {
  if (!isAbsolute(file) || !existsSync(file) || !statSync(file).isFile()) throw new BackupProblem('bad_path', 'That file does not exist')
  let db: Database.Database
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
  } catch {
    throw new BackupProblem('invalid_backup', 'That file is not a Theama backup')
  }
  try {
    const version = db.pragma('user_version', { simple: true }) as number
    if (version > LATEST_SCHEMA_VERSION) throw new BackupProblem('newer_version', 'This backup was made by a newer Theama. Update Theama to restore it.')
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name))
    if (version < 1 || !['application_setting', 'library_source', 'media_file'].every((t) => tables.has(t))) {
      throw new BackupProblem('invalid_backup', 'That file is not a Theama backup')
    }
    const check = db.pragma('quick_check', { simple: true })
    if (check !== 'ok') throw new BackupProblem('invalid_backup', 'That backup is damaged')
    const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
    return {
      schemaVersion: version,
      files: count('SELECT COUNT(*) AS n FROM media_file'),
      titles: count('SELECT COUNT(DISTINCT title_key) AS n FROM media_file WHERE title_key IS NOT NULL'),
      collections: tables.has('collection') ? count("SELECT COUNT(*) AS n FROM collection WHERE kind = 'user'") : 0,
    }
  } catch (err) {
    if (err instanceof BackupProblem) throw err
    throw new BackupProblem('invalid_backup', 'That file is not a Theama backup')
  } finally {
    db.close()
  }
}

/** Copies the database at `source` to `target` as a clean, compacted file (VACUUM INTO), including anything still in its write-ahead log. */
export function copyDatabase(source: Database.Database, target: string): void {
  const tmp = `${target}.partial`
  rmSync(tmp, { force: true })
  source.prepare('VACUUM INTO ?').run(tmp)
  renameSync(tmp, target)
}

interface PendingMeta {
  source: string
  stagedAt: string
}

export interface BackupDeps {
  raw: Database.Database
  /** The folder backups are kept in. */
  dir: string
  /** The folder a staged restore waits in. */
  restoreDir: string
  logger: Logger
  now?: () => Date
}

/**
 * Backups of the library's database (matches, collections, watched marks, settings, journal), made with
 * SQLite itself so a backup is consistent even while Theama is running. Artwork is not included: it is
 * downloaded again. The TMDB key and the API token are not in the database and so never in a backup.
 */
export class BackupService {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly d: BackupDeps) {
    mkdirSync(d.dir, { recursive: true })
  }

  private now(): Date {
    return this.d.now?.() ?? new Date()
  }

  create(kind: BackupKind): BackupInfo {
    const name = `theama-${kind}-${stamp(this.now())}-v${LATEST_SCHEMA_VERSION}.db`
    copyDatabase(this.d.raw, join(this.d.dir, name))
    this.prune()
    this.d.logger.info({ name, kind }, 'Backup made')
    return this.info(name)!
  }

  private info(name: string): BackupInfo | null {
    const m = NAME.exec(name)
    if (!m) return null
    try {
      const st = statSync(join(this.d.dir, name))
      return { name, kind: m[1] as BackupKind, createdAt: fromStamp(m[2]!), size: st.size, schemaVersion: Number(m[3]) }
    } catch {
      return null
    }
  }

  /** Newest first. */
  list(): BackupInfo[] {
    return readdirSync(this.d.dir)
      .map((n) => this.info(n))
      .filter((b): b is BackupInfo => b !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name))
  }

  /** Removes automatic backups beyond the number worth keeping. */
  private prune(): void {
    const all = this.list()
    for (const [kind, keep] of Object.entries(KEEP) as [BackupKind, number][]) {
      for (const old of all.filter((b) => b.kind === kind).slice(keep)) {
        rmSync(join(this.d.dir, old.name), { force: true })
        this.d.logger.info({ name: old.name }, 'Old automatic backup removed')
      }
    }
  }

  remove(name: string): void {
    if (!this.info(name)) throw new BackupProblem('not_found', 'No such backup')
    rmSync(join(this.d.dir, name), { force: true })
  }

  /** Makes a daily backup if there is no backup from the last 24 hours. Cheap to call often. */
  ensureDaily(): BackupInfo | null {
    const newest = this.list().find((b) => b.kind === 'daily' || b.kind === 'manual')
    if (newest && this.now().getTime() - new Date(newest.createdAt).getTime() < DAY_MS) return null
    return this.create('daily')
  }

  start(): void {
    try {
      this.ensureDaily()
    } catch (err) {
      this.d.logger.error({ err }, 'The daily backup failed')
    }
    this.timer = setInterval(() => {
      try {
        this.ensureDaily()
      } catch (err) {
        this.d.logger.error({ err }, 'The daily backup failed')
      }
    }, 6 * 60 * 60 * 1000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  // --- restoring -----------------------------------------------------------------

  private get pendingFile(): string {
    return join(this.d.restoreDir, 'pending.db')
  }
  private get metaFile(): string {
    return join(this.d.restoreDir, 'pending.json')
  }

  pending(): PendingRestore | null {
    try {
      if (!existsSync(this.pendingFile)) return null
      const meta = JSON.parse(readFileSync(this.metaFile, 'utf8')) as PendingMeta
      const s = inspectDatabase(this.pendingFile)
      return { source: meta.source, schemaVersion: s.schemaVersion, stagedAt: meta.stagedAt, summary: { files: s.files, titles: s.titles, collections: s.collections } }
    } catch {
      return null
    }
  }

  /**
   * Prepares a restore: checks the file and sets it aside. Nothing in the running database changes; the swap
   * happens when the service next starts (see applyPendingRestore), because the database is open now.
   */
  stage(source: { name: string } | { path: string }): PendingRestore {
    let file: string
    let label: string
    if ('name' in source) {
      if (!this.info(source.name)) throw new BackupProblem('not_found', 'No such backup')
      file = join(this.d.dir, source.name)
      label = source.name
    } else {
      file = source.path
      label = basename(source.path)
    }
    inspectDatabase(file) // throws with a reason fit to show
    mkdirSync(this.d.restoreDir, { recursive: true })
    rmSync(this.pendingFile, { force: true })
    copyFileSync(file, this.pendingFile)
    writeFileSync(this.metaFile, JSON.stringify({ source: label, stagedAt: this.now().toISOString() } satisfies PendingMeta))
    this.d.logger.info({ source: label }, 'Restore staged; it takes effect when the service restarts')
    return this.pending()!
  }

  cancelPending(): void {
    rmSync(this.pendingFile, { force: true })
    rmSync(this.metaFile, { force: true })
  }
}

/**
 * Called once at start-up, before the database is opened. If a restore is waiting, the current database is
 * first saved as a "pre-restore" backup, then replaced. A staged file that no longer checks out is dropped
 * and the current database is left untouched.
 */
export function applyPendingRestore(paths: { databaseFile: string; backupsDir: string; restoreDir: string }, logger: Logger, now: Date = new Date()): boolean {
  const pending = join(paths.restoreDir, 'pending.db')
  if (!existsSync(pending)) return false
  const discard = (): void => {
    rmSync(pending, { force: true })
    rmSync(join(paths.restoreDir, 'pending.json'), { force: true })
  }
  try {
    inspectDatabase(pending)
  } catch (err) {
    logger.error({ err }, 'The staged restore is not usable and was discarded; the current database is unchanged')
    discard()
    return false
  }
  mkdirSync(paths.backupsDir, { recursive: true })
  if (existsSync(paths.databaseFile)) {
    // Keep what is being replaced. Opening it also folds in anything still in its write-ahead log.
    try {
      const current = new Database(paths.databaseFile, { fileMustExist: true })
      const version = current.pragma('user_version', { simple: true }) as number
      copyDatabase(current, join(paths.backupsDir, `theama-pre-restore-${stamp(now)}-v${version}.db`))
      current.close()
    } catch (err) {
      logger.error({ err }, 'Could not save the current database before restoring; the restore was cancelled')
      discard()
      return false
    }
  }
  for (const f of [paths.databaseFile, `${paths.databaseFile}-wal`, `${paths.databaseFile}-shm`]) rmSync(f, { force: true })
  mkdirSync(dirname(paths.databaseFile), { recursive: true })
  renameSync(pending, paths.databaseFile)
  rmSync(join(paths.restoreDir, 'pending.json'), { force: true })
  logger.warn('A staged restore was applied: the library database was replaced from a backup (the previous one is kept in backups)')
  return true
}

/** Before upgrading a database to a newer layout, keep a copy of it as it was. Returns the file made, or null if none was needed. */
export function backupBeforeMigration(databaseFile: string, backupsDir: string, logger: Logger, now: Date = new Date()): string | null {
  if (!existsSync(databaseFile)) return null
  let db: Database.Database | null = null
  try {
    db = new Database(databaseFile, { fileMustExist: true })
    const version = db.pragma('user_version', { simple: true }) as number
    if (version === 0 || version >= LATEST_SCHEMA_VERSION) return null
    mkdirSync(backupsDir, { recursive: true })
    const target = join(backupsDir, `theama-pre-migration-${stamp(now)}-v${version}.db`)
    copyDatabase(db, target)
    logger.info({ from: version, to: LATEST_SCHEMA_VERSION }, 'Database backed up before it is upgraded')
    return target
  } catch (err) {
    logger.error({ err }, 'Could not back up the database before upgrading it')
    return null
  } finally {
    db?.close()
  }
}
