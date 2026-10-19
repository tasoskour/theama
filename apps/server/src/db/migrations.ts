import type Database from 'better-sqlite3'

/**
 * Forward-only SQL migrations, applied in order inside a transaction. The
 * applied version is stored in PRAGMA user_version. Migrations are plain
 * strings (not files) so they survive bundling into a single server file.
 * Never edit a released migration; append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  /* 1 — foundation */
  `
  CREATE TABLE application_setting (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE service_event (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    time    TEXT NOT NULL,
    kind    TEXT NOT NULL CHECK (kind IN ('start','stop','crash','restart','migrate')),
    reason  TEXT,
    pid     INTEGER,
    version TEXT
  );
  CREATE INDEX idx_service_event_time ON service_event(time);

  CREATE TABLE library_source (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    path                TEXT NOT NULL UNIQUE,
    library_type        TEXT NOT NULL CHECK (library_type IN ('movies','series','videos','auto')),
    recursive           INTEGER NOT NULL DEFAULT 1,
    enabled             INTEGER NOT NULL DEFAULT 1,
    volume_id           TEXT,
    availability        TEXT NOT NULL DEFAULT 'unknown' CHECK (availability IN ('online','offline','unknown')),
    last_seen_online_at TEXT,
    created_at          TEXT NOT NULL
  );

  CREATE TABLE scan_job (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   INTEGER NOT NULL REFERENCES library_source(id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
    started_at  TEXT,
    finished_at TEXT,
    diagnostics TEXT
  );
  CREATE INDEX idx_scan_job_source ON scan_job(source_id);
  `,
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length

/** Applies pending migrations. Returns the versions that were applied. */
export function migrate(db: Database.Database): number[] {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${current} is newer than this build supports (v${LATEST_SCHEMA_VERSION}). ` +
        'Install a newer Theama or restore a backup.',
    )
  }
  const applied: number[] = []
  for (let v = current; v < LATEST_SCHEMA_VERSION; v++) {
    const sql = MIGRATIONS[v]!
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${v + 1}`)
    })()
    applied.push(v + 1)
  }
  return applied
}
