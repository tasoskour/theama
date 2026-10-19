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
  /* 2 — discovered media files */
  `
  ALTER TABLE scan_job ADD COLUMN summary TEXT;

  CREATE TABLE media_file (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id     INTEGER NOT NULL REFERENCES library_source(id) ON DELETE CASCADE,
    path          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    mtime_ms      INTEGER NOT NULL,
    volume_id     TEXT,
    file_id       TEXT,
    state         TEXT NOT NULL DEFAULT 'available' CHECK (state IN ('available','missing_unconfirmed')),
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    missing_since TEXT,
    kind          TEXT NOT NULL CHECK (kind IN ('movie','episode','video','extra')),
    guessed_title TEXT NOT NULL,
    guessed_year  INTEGER,
    season        INTEGER,
    episode       INTEGER,
    episode_end   INTEGER,
    episode_title TEXT,
    probed_at     TEXT,
    probe_error   TEXT,
    duration_ms   INTEGER,
    width         INTEGER,
    height        INTEGER,
    container     TEXT,
    video_codec   TEXT,
    audio_codecs  TEXT,
    subtitle_count INTEGER
  );
  CREATE UNIQUE INDEX uq_media_file_source_path ON media_file(source_id, path COLLATE NOCASE);
  CREATE INDEX idx_media_file_kind_title ON media_file(kind, guessed_title COLLATE NOCASE, id);
  CREATE INDEX idx_media_file_identity ON media_file(source_id, volume_id, file_id);
  CREATE INDEX idx_media_file_state ON media_file(source_id, state);
  `,
  /* 3 — title grouping and full-text search */
  `
  ALTER TABLE media_file ADD COLUMN title_key TEXT;
  CREATE INDEX idx_media_file_title_key ON media_file(kind, title_key);

  -- Contentless FTS5 index over what a person types: titles, episode titles and the words of the path.
  -- The text stored in it is folded by the application (Greek accents and final sigma are not handled by
  -- SQLite's own remove_diacritics), so it is written by MediaFileRepo, never by SQL triggers. Only
  -- deletes are done in SQL because a folder removal cascades to its files.
  CREATE VIRTUAL TABLE media_file_fts USING fts5(
    guessed_title, episode_title, path_text,
    content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER media_file_fts_delete AFTER DELETE ON media_file BEGIN
    DELETE FROM media_file_fts WHERE rowid = old.id;
  END;
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
