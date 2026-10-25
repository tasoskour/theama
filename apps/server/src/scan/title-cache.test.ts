import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { openDatabase } from '../db/client'
import { TitleRepo } from './titles'

it('invalidates cached pages for local/external writes and rollbacks, without sharing mutable responses', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'theama-title-cache-'))
  const file = join(directory, 'library.db')
  const handle = openDatabase(file)
  const external = new Database(file)
  try {
    handle.raw.exec("INSERT INTO library_source(path, library_type, created_at) VALUES ('D:\\M', 'movies', 'x')")
    handle.raw.exec("INSERT INTO media_file(source_id, path, size, mtime_ms, first_seen_at, last_seen_at, kind, guessed_title, title_key) VALUES (1, 'D:\\M\\film.mkv', 1, 1, 'x', 'x', 'movie', 'Original', 'movie:film:')")
    const titles = new TitleRepo(handle.raw)
    const update = handle.raw.prepare('UPDATE media_file SET guessed_title = ?')
    const name = () => titles.list({ limit: 60 }).items[0]!.title
    const first = titles.list({ limit: 60 })
    first.items[0]!.title = 'Changed by caller'
    expect(name()).toBe('Original')
    update.run('Local edit')
    expect(name()).toBe('Local edit')
    external.prepare('UPDATE media_file SET guessed_title = ?').run('External edit')
    expect(name()).toBe('External edit')
    expect(() => handle.raw.transaction(() => {
      update.run('Inside transaction')
      expect(name()).toBe('Inside transaction')
      throw new Error('rollback')
    })()).toThrow('rollback')
    expect(name()).toBe('External edit')
  } finally { external.close(); handle.close(); await rm(directory, { recursive: true, force: true }) }
})
