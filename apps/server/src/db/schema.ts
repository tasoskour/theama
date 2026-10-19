import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core'

/**
 * Key/value application settings. Values are JSON-encoded so the table never
 * needs a migration when a setting is added.
 */
export const applicationSetting = sqliteTable('application_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** Start/stop/crash history of the backend process. */
export const serviceEvent = sqliteTable(
  'service_event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    time: text('time').notNull(),
    kind: text('kind', { enum: ['start', 'stop', 'crash', 'restart', 'migrate'] }).notNull(),
    reason: text('reason'),
    pid: integer('pid'),
    version: text('version'),
  },
  (t) => [index('idx_service_event_time').on(t.time)],
)

/**
 * A user-chosen media folder. Availability columns are in place from the start
 * so offline drives are modelled before scanning exists (Phase 2).
 */
export const librarySource = sqliteTable('library_source', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull().unique(),
  libraryType: text('library_type', { enum: ['movies', 'series', 'videos', 'auto'] }).notNull(),
  recursive: integer('recursive', { mode: 'boolean' }).notNull().default(true),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** Volume serial number captured at add time; detects a different drive under the same letter. */
  volumeId: text('volume_id'),
  availability: text('availability', { enum: ['online', 'offline', 'unknown'] })
    .notNull()
    .default('unknown'),
  lastSeenOnlineAt: text('last_seen_online_at'),
  createdAt: text('created_at').notNull(),
})

export const scanJob = sqliteTable(
  'scan_job',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => librarySource.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed', 'cancelled'] }).notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    diagnostics: text('diagnostics'),
    /** JSON counters (found, new, changed, moved, missing, skipped, probed, errors). */
    summary: text('summary'),
  },
  (t) => [index('idx_scan_job_source').on(t.sourceId)],
)

/**
 * A video file discovered by a scan. Title/season/episode are guesses derived from
 * the file name (recomputable); probe columns come from FFprobe. Phase 4 links these
 * rows to real titles without losing them.
 */
export const mediaFile = sqliteTable(
  'media_file',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => librarySource.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    size: integer('size').notNull(),
    mtimeMs: integer('mtime_ms').notNull(),
    volumeId: text('volume_id'),
    /** NTFS file id; stays the same when a file is renamed or moved on the same volume. */
    fileId: text('file_id'),
    state: text('state', { enum: ['available', 'missing_unconfirmed'] }).notNull().default('available'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    missingSince: text('missing_since'),
    kind: text('kind', { enum: ['movie', 'episode', 'video', 'extra'] }).notNull(),
    guessedTitle: text('guessed_title').notNull(),
    guessedYear: integer('guessed_year'),
    season: integer('season'),
    episode: integer('episode'),
    episodeEnd: integer('episode_end'),
    episodeTitle: text('episode_title'),
    probedAt: text('probed_at'),
    probeError: text('probe_error'),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    container: text('container'),
    videoCodec: text('video_codec'),
    /** Comma-separated codec names. */
    audioCodecs: text('audio_codecs'),
    subtitleCount: integer('subtitle_count'),
    /** Identity of the title this file belongs to (see titleKeyFor); groups episodes into series. */
    titleKey: text('title_key'),
  },
  (t) => [
    index('idx_media_file_kind_title').on(t.kind, t.guessedTitle, t.id),
    index('idx_media_file_identity').on(t.sourceId, t.volumeId, t.fileId),
    index('idx_media_file_state').on(t.sourceId, t.state),
    index('idx_media_file_title_key').on(t.kind, t.titleKey),
  ],
)
