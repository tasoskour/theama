import { integer, primaryKey, real, sqliteTable, text, index } from 'drizzle-orm/sqlite-core'

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

export const libraryExclusion = sqliteTable(
  'library_exclusion',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id')
      .notNull()
      .references(() => librarySource.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    kind: text('kind', { enum: ['file', 'folder'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_library_exclusion_source').on(t.sourceId)],
)

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
    /** JSON: audio and subtitle streams from FFprobe; null until the file was read by a build that stores them. */
    tracks: text('tracks'),
    /** Kept in the database so removing an exclusion restores history, but omitted everywhere in the UI. */
    excluded: integer('excluded', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('idx_media_file_kind_title').on(t.kind, t.guessedTitle, t.id),
    index('idx_media_file_identity').on(t.sourceId, t.volumeId, t.fileId),
    index('idx_media_file_state').on(t.sourceId, t.state),
    index('idx_media_file_title_key').on(t.kind, t.titleKey),
    index('idx_media_file_title_episode').on(t.titleKey, t.season, t.episode),
  ],
)

/** The real-world identity chosen for a group of files (see docs/07-metadata-matching.md). */
export const titleMatch = sqliteTable(
  'title_match',
  {
    titleKey: text('title_key').primaryKey(),
    kind: text('kind', { enum: ['movie', 'series'] }).notNull(),
    state: text('state', { enum: ['matched', 'ambiguous', 'unmatched'] }).notNull(),
    provider: text('provider'),
    externalId: text('external_id'),
    score: real('score'),
    /** JSON: how each signal scored. */
    signals: text('signals'),
    /** JSON: the best guesses, kept only while the match is ambiguous. */
    candidates: text('candidates'),
    decidedBy: text('decided_by', { enum: ['auto', 'user'] }).notNull(),
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    attempts: integer('attempts').notNull().default(0),
    attemptedAt: text('attempted_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('idx_title_match_state').on(t.state), index('idx_title_match_external').on(t.provider, t.externalId)],
)

/** Provider data for a matched title; never mixed with what the user's files say. */
export const titleMetadata = sqliteTable('title_metadata', {
  titleKey: text('title_key').primaryKey(),
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  language: text('language').notNull(),
  title: text('title').notNull(),
  originalTitle: text('original_title'),
  year: integer('year'),
  tagline: text('tagline'),
  overview: text('overview'),
  runtimeMin: integer('runtime_min'),
  genres: text('genres').notNull().default('[]'),
  rating: real('rating'),
  votes: integer('votes'),
  /** Provider-relative image paths are kept so artwork that failed to download can be fetched later. */
  posterPath: text('poster_path'),
  posterFile: text('poster_file'),
  backdropPath: text('backdrop_path'),
  backdropFile: text('backdrop_file'),
  castJson: text('cast_json').notNull().default('[]'),
  imdbId: text('imdb_id'),
  status: text('status'),
  fetchedAt: text('fetched_at').notNull(),
  collectionExternalId: text('collection_external_id'),
  /** Bumped when a new build stores more fields; older rows are refreshed in the background. */
  version: integer('version').notNull().default(1),
})

export const episodeMetadata = sqliteTable(
  'episode_metadata',
  {
    titleKey: text('title_key').notNull(),
    season: integer('season').notNull(),
    episode: integer('episode').notNull(),
    name: text('name'),
    overview: text('overview'),
    airDate: text('air_date'),
    runtimeMin: integer('runtime_min'),
    stillPath: text('still_path'),
    stillFile: text('still_file'),
  },
  (t) => [primaryKey({ columns: [t.titleKey, t.season, t.episode] })],
)

/** A set of titles: published by the provider (official) or made by the person (user). */
export const collection = sqliteTable('collection', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['official', 'user'] }).notNull(),
  provider: text('provider'),
  externalId: text('external_id'),
  name: text('name').notNull(),
  overview: text('overview'),
  posterPath: text('poster_path'),
  posterFile: text('poster_file'),
  backdropPath: text('backdrop_path'),
  backdropFile: text('backdrop_file'),
  fetchedAt: text('fetched_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const collectionMember = sqliteTable(
  'collection_member',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collection.id, { onDelete: 'cascade' }),
    titleKey: text('title_key'),
    externalId: text('external_id'),
    title: text('title').notNull(),
    year: integer('year'),
    releaseDate: text('release_date'),
    overview: text('overview'),
    posterPath: text('poster_path'),
    posterFile: text('poster_file'),
    customOrder: integer('custom_order'),
  },
  (t) => [index('idx_collection_member_ext').on(t.externalId)],
)

export const playbackState = sqliteTable(
  'playback_state',
  {
    fileId: integer('file_id')
      .primaryKey()
      .references(() => mediaFile.id, { onDelete: 'cascade' }),
    watched: integer('watched', { mode: 'boolean' }).notNull().default(false),
    watchedAt: text('watched_at'),
    lastPlayedAt: text('last_played_at'),
    playCount: integer('play_count').notNull().default(0),
    source: text('source').notNull().default('manual'),
  },
  (t) => [index('idx_playback_last').on(t.lastPlayedAt)],
)

/** The journal of file renames: written before a rename happens, updated after, kept for undo. */
export const fileOperation = sqliteTable(
  'file_operation',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    batchId: text('batch_id').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind', { enum: ['video', 'subtitle'] }).notNull(),
    fileId: integer('file_id'),
    fromPath: text('from_path').notNull(),
    toPath: text('to_path').notNull(),
    status: text('status', { enum: ['pending', 'done', 'failed', 'rolled_back', 'rollback_failed'] }).notNull(),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('idx_file_operation_batch').on(t.batchId, t.seq)],
)
