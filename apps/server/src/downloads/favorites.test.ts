import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { SaveFavoriteRequest, providerIdentityKey } from '@theama/contracts'
import { openDatabase } from '../db/client'
import { MIGRATIONS, migrate } from '../db/migrations'
import { FavoritesRepo } from './favorites'

const movie = SaveFavoriteRequest.parse({ provider: 'tmdb', kind: 'movie', externalId: '42', title: 'A title', originalTitle: null, year: 2026, overview: 'A description', posterUrl: '/api/v1/artwork/thumb-test.jpg', score: null, genres: ['Drama'], rating: 8 })

describe('download favorites', () => {
  it('upgrades an existing library and preserves it while adding favorites', () => {
    const raw = new Database(':memory:')
    try {
      for (const sql of MIGRATIONS.slice(0, 12)) raw.exec(sql)
      raw.pragma('user_version = 12')
      raw.prepare("INSERT INTO library_source (path, library_type, created_at) VALUES ('D:\\Movies', 'movies', 'now')").run()
      expect(migrate(raw)).toEqual([13])
      expect(raw.prepare('SELECT path FROM library_source').get()).toEqual({ path: 'D:\\Movies' })
      expect(new FavoritesRepo(raw).list()).toEqual([])
    } finally { raw.close() }
  })

  it('persists snapshots across reopening and keeps type/provider identities separate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'theama-favorites-'))
    const child = relative(tmpdir(), dir)
    if (isAbsolute(child) || !/^theama-favorites-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    const path = join(dir, 'test.db')
    let handle = openDatabase(path)
    try {
      let repo = new FavoritesRepo(handle.raw)
      const saved = repo.save(movie)
      expect(repo.save({ ...movie, title: 'Duplicate title' })).toEqual(saved)
      repo.save({ ...movie, kind: 'series' })
      repo.save({ ...movie, provider: 'other' })
      handle.raw.prepare("UPDATE download_favorite SET saved_at = '2099-01-01T00:00:00.000Z' WHERE kind = 'series'").run()
      handle.close()
      handle = openDatabase(path)
      repo = new FavoritesRepo(handle.raw)
      expect(repo.list()).toHaveLength(3)
      expect(repo.list()[0]?.kind).toBe('series')
      expect(repo.list().find((item) => providerIdentityKey(item) === providerIdentityKey(movie))).toEqual(saved)
      expect(repo.remove(movie)).toBe(true)
      expect(repo.remove(movie)).toBe(false)
      expect(repo.list()).toHaveLength(2)
    } finally {
      handle.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects empty identities, invalid types and external artwork URLs', () => {
    for (const patch of [{ provider: '' }, { externalId: '' }, { kind: 'video' }, { posterUrl: 'https://example.com/a.jpg' }, { rating: 11 }]) {
      expect(SaveFavoriteRequest.safeParse({ ...movie, ...patch }).success).toBe(false)
    }
  })
})
