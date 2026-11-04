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
  /* 4 — metadata: matches, provider data, episode details; search also covers the provider's titles */
  `
  -- Which real-world title a group of files (title_key) is, and how sure we are. Keyed by title_key so it
  -- survives rescans, renames and a missing drive; a locked row is never replaced automatically.
  CREATE TABLE title_match (
    title_key    TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('movie','series')),
    state        TEXT NOT NULL CHECK (state IN ('matched','ambiguous','unmatched')),
    provider     TEXT,
    external_id  TEXT,
    score        REAL,
    signals      TEXT,
    candidates   TEXT,
    decided_by   TEXT NOT NULL CHECK (decided_by IN ('auto','user')),
    locked       INTEGER NOT NULL DEFAULT 0,
    attempts     INTEGER NOT NULL DEFAULT 0,
    attempted_at TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX idx_title_match_state ON title_match(state);

  -- What the provider told us, kept apart from the user's files. Ratings keep their source.
  CREATE TABLE title_metadata (
    title_key      TEXT PRIMARY KEY,
    provider       TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    language       TEXT NOT NULL,
    title          TEXT NOT NULL,
    original_title TEXT,
    year           INTEGER,
    tagline        TEXT,
    overview       TEXT,
    runtime_min    INTEGER,
    genres         TEXT NOT NULL DEFAULT '[]',
    rating         REAL,
    votes          INTEGER,
    poster_path    TEXT,
    poster_file    TEXT,
    backdrop_path  TEXT,
    backdrop_file  TEXT,
    cast_json      TEXT NOT NULL DEFAULT '[]',
    imdb_id        TEXT,
    status         TEXT,
    fetched_at     TEXT NOT NULL
  );

  CREATE TABLE episode_metadata (
    title_key   TEXT NOT NULL,
    season      INTEGER NOT NULL,
    episode     INTEGER NOT NULL,
    name        TEXT,
    overview    TEXT,
    air_date    TEXT,
    runtime_min INTEGER,
    still_path  TEXT,
    still_file  TEXT,
    PRIMARY KEY (title_key, season, episode)
  );

  -- The search index gains the provider's titles (translated and original). Recreated empty; the server
  -- notices the row-count mismatch on start and refills it.
  DROP TRIGGER media_file_fts_delete;
  DROP TABLE media_file_fts;
  CREATE VIRTUAL TABLE media_file_fts USING fts5(
    guessed_title, episode_title, path_text, meta_text,
    content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER media_file_fts_delete AFTER DELETE ON media_file BEGIN
    DELETE FROM media_file_fts WHERE rowid = old.id;
  END;
  `,
  /* 5 — collections; provider data records which collection a movie belongs to and a data version */
  `
  ALTER TABLE title_metadata ADD COLUMN collection_external_id TEXT;
  -- Rows written before a column existed carry version 1; the metadata manager refreshes them in the
  -- background, which is how older data picks up fields added later without a manual step.
  ALTER TABLE title_metadata ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

  CREATE TABLE collection (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL CHECK (kind IN ('official','user')),
    provider      TEXT,
    external_id   TEXT,
    name          TEXT NOT NULL,
    overview      TEXT,
    poster_path   TEXT,
    poster_file   TEXT,
    backdrop_path TEXT,
    backdrop_file TEXT,
    fetched_at    TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_collection_provider ON collection(provider, external_id) WHERE provider IS NOT NULL;

  -- Official members are provider movies (external_id) that may or may not be in the library; whether one is
  -- local is worked out when reading, from the movie's match, so identifying a title later links it at once.
  -- User members are library titles (title_key) and keep the name they had when added, for when the files are gone.
  CREATE TABLE collection_member (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
    title_key     TEXT,
    external_id   TEXT,
    title         TEXT NOT NULL,
    year          INTEGER,
    release_date  TEXT,
    overview      TEXT,
    poster_path   TEXT,
    poster_file   TEXT,
    custom_order  INTEGER
  );
  CREATE UNIQUE INDEX uq_collection_member_key ON collection_member(collection_id, title_key) WHERE title_key IS NOT NULL;
  CREATE UNIQUE INDEX uq_collection_member_ext ON collection_member(collection_id, external_id) WHERE external_id IS NOT NULL;
  CREATE INDEX idx_collection_member_ext ON collection_member(external_id);
  `,
  /* 6 — playback state, stream details, file-operation journal */
  `
  -- Audio and subtitle streams (JSON) read by FFprobe. Files probed before this column existed have NULL
  -- and are read again at the next scan.
  ALTER TABLE media_file ADD COLUMN tracks TEXT;

  -- What the person has watched. Per file, so a rename or move keeps it; titles and seasons are rolled up
  -- from their files. Theama cannot see inside an external player, so watched is set by hand or by
  -- marking a title, and a launch only records that something was started (last_played_at).
  CREATE TABLE playback_state (
    file_id        INTEGER PRIMARY KEY REFERENCES media_file(id) ON DELETE CASCADE,
    watched        INTEGER NOT NULL DEFAULT 0,
    watched_at     TEXT,
    last_played_at TEXT,
    play_count     INTEGER NOT NULL DEFAULT 0,
    source         TEXT NOT NULL DEFAULT 'manual'
  );
  CREATE INDEX idx_playback_last ON playback_state(last_played_at);

  -- Every rename is written here before it happens and updated after, so an interrupted batch can be
  -- understood and any finished one undone. No foreign key to media_file: the record outlives the file row.
  CREATE TABLE file_operation (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id    TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('video','subtitle')),
    file_id     INTEGER,
    from_path   TEXT NOT NULL,
    to_path     TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('pending','done','failed','rolled_back','rollback_failed')),
    error       TEXT,
    created_at  TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX idx_file_operation_batch ON file_operation(batch_id, seq);
  `,
  /* 7 — lookups of a title's files by season and episode (missing-episode counts, coverage, next episode) */
  `
  CREATE INDEX idx_media_file_title_episode ON media_file(title_key, season, episode);
  -- Collections and "part of" look titles up by the provider's id.
  CREATE INDEX idx_title_match_external ON title_match(provider, external_id);
  `,
  /* 8 — persistent file and subfolder exclusions */
  `
  ALTER TABLE media_file ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE library_exclusion (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id  INTEGER NOT NULL REFERENCES library_source(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('file','folder')),
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX uq_library_exclusion_path ON library_exclusion(source_id, path COLLATE NOCASE);
  CREATE INDEX idx_library_exclusion_source ON library_exclusion(source_id);
  `,
  /* 9 — persistent per-file category corrections */
  `
  ALTER TABLE media_file ADD COLUMN kind_override TEXT
    CHECK (kind_override IS NULL OR kind_override IN ('movie','episode','video'));
  CREATE INDEX idx_media_file_kind_override ON media_file(kind_override);
  `,
  /* 10 — where playback stopped, reported by players that can tell us */
  `
  ALTER TABLE playback_state ADD COLUMN position_seconds INTEGER;
  ALTER TABLE playback_state ADD COLUMN duration_seconds INTEGER;
  `,
  /* 11 — provider-selected external trailer */
  `
  ALTER TABLE title_metadata ADD COLUMN trailer_site TEXT;
  ALTER TABLE title_metadata ADD COLUMN trailer_key TEXT;
  `,
  /* 12 — indexed cast and director credits for local-library connections */
  `
  CREATE TABLE title_credit (
    title_key          TEXT NOT NULL REFERENCES title_metadata(title_key) ON DELETE CASCADE,
    provider           TEXT NOT NULL,
    person_external_id TEXT NOT NULL,
    name               TEXT NOT NULL,
    category           TEXT NOT NULL CHECK (category IN ('actor','director')),
    role               TEXT,
    billing_order      INTEGER NOT NULL,
    PRIMARY KEY (title_key, category, person_external_id)
  );
  CREATE INDEX idx_title_credit_person ON title_credit(provider, person_external_id, title_key);
  `,
  /* 13 — saved download suggestions, independent of local library files */
  `
  CREATE TABLE download_favorite (
    provider    TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('movie','series')),
    external_id TEXT NOT NULL,
    snapshot    TEXT NOT NULL,
    saved_at    TEXT NOT NULL,
    PRIMARY KEY (provider, kind, external_id)
  );
  `,
  /* 14 — titles the person removed from "continue watching" (they return when played again) */
  `
  CREATE TABLE continue_dismissal (
    title_key    TEXT PRIMARY KEY,
    dismissed_at TEXT NOT NULL
  );
  `,
  /* 15 — a person's series name for a file, so hand-grouped episodes stay together across rescans */
  `
  ALTER TABLE media_file ADD COLUMN title_override TEXT;
  `,
  /* 16 — locally cached cast and director portraits */
  `
  ALTER TABLE title_credit ADD COLUMN profile_file TEXT;
  `,
  /* 17 — ratings already supplied with official collection members */
  `
  ALTER TABLE collection_member ADD COLUMN rating REAL;
  ALTER TABLE collection ADD COLUMN rating_enriched INTEGER NOT NULL DEFAULT 0;
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
