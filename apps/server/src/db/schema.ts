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
  },
  (t) => [index('idx_scan_job_source').on(t.sourceId)],
)
