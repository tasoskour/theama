import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { LATEST_SCHEMA_VERSION, migrate } from './migrations'
import { openDatabase } from './client'
import { SettingsRepo } from '../repo/settings'
import { ServiceEventRepo, recordCrashIfUncleanShutdown } from '../repo/service-events'

describe('migrations', () => {
  it('applies from an empty database and is idempotent', () => {
    const db = new Database(':memory:')
    expect(migrate(db)).toEqual(Array.from({ length: LATEST_SCHEMA_VERSION }, (_, i) => i + 1))
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(migrate(db)).toEqual([])
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['application_setting', 'service_event', 'library_source', 'scan_job', 'media_file']),
    )
  })

  it('refuses a database from a newer build', () => {
    const db = new Database(':memory:')
    db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    expect(() => migrate(db)).toThrow(/newer/)
  })

  it('cascades scan jobs when a source is removed', () => {
    const { raw } = openDatabase(':memory:')
    raw.prepare("INSERT INTO library_source (path, library_type, created_at) VALUES ('D:\\Movies','movies','now')").run()
    raw.prepare("INSERT INTO scan_job (source_id, status) VALUES (1, 'queued')").run()
    raw.prepare('DELETE FROM library_source WHERE id = 1').run()
    expect(raw.prepare('SELECT COUNT(*) AS n FROM scan_job').get()).toEqual({ n: 0 })
  })
})

describe('SettingsRepo', () => {
  it('returns defaults, persists patches and ignores corrupt values', () => {
    const { db, raw } = openDatabase(':memory:')
    const repo = new SettingsRepo(db)
    expect(repo.get()).toEqual({ language: 'en', theme: 'dark', textSize: 'default', visualMode: 'immersive', graphicsQuality: 'medium', backdropScene: 'classic', backdropByGenre: true, backdropByKind: true, logRetentionDays: 14, logDetail: 'info', metadataLanguage: 'en', subtitleLanguages: ['el', 'en'], autoPlayNext: true, nextEpisodeCountdownSeconds: 5, renameMovieTemplate: '{title} ({year})', renameEpisodeTemplate: '{title} - {episodeCode} - {episodeTitle}', downloadMovieSourceId: null, downloadSeriesSourceId: null, downloadsShowAll: false, downloadAskFolder: false })
    expect(repo.update({ language: 'el', theme: 'dark' })).toMatchObject({ language: 'el', theme: 'dark' })
    raw.prepare("UPDATE application_setting SET value = '\"klingon\"' WHERE key = 'language'").run()
    expect(repo.get()).toMatchObject({ language: 'en', theme: 'dark' })
  })
})

describe('service events', () => {
  it('records a crash when the last event was a start', () => {
    const { db } = openDatabase(':memory:')
    const repo = new ServiceEventRepo(db)
    expect(recordCrashIfUncleanShutdown(repo)).toBe(false)
    repo.record('start', { pid: 10 })
    expect(recordCrashIfUncleanShutdown(repo)).toBe(true)
    expect(repo.list().map((e) => e.kind)).toEqual(['crash', 'start'])
    repo.record('stop')
    expect(recordCrashIfUncleanShutdown(repo)).toBe(false)
  })
})
