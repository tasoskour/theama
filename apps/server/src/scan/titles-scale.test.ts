import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seed } from '../../../../tools/perf/seed'
import { CollectionRepo } from '../collections/store'
import { openDatabase, type DbHandle } from '../db/client'
import { MetadataRepo } from '../metadata/store'
import { PlaybackRepo } from '../playback/store'
import { TitleRepo } from './titles'

/**
 * Guards against a library that becomes unusable as it grows. The bounds are generous (this is not a benchmark:
 * `yarn perf` is), but an accidental quadratic query, like one that once made 5,000 titles take minutes to list,
 * misses them by orders of magnitude.
 */
let dir: string
let handle: DbHandle
let titles: TitleRepo
let keys: { series: string; movie: string }

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'theama-scale-'))
  keys = seed(dir, { movies: 1500, series: 300, episodesPerSeries: 12, videos: 50 }).keys
  handle = openDatabase(join(dir, 'data', 'theama.db'))
  titles = new TitleRepo(handle.raw, new MetadataRepo(handle.raw))
})
afterAll(async () => {
  handle.close()
  await rm(dir, { recursive: true, force: true })
})

const ms = (fn: () => unknown): number => {
  const t = performance.now()
  fn()
  return performance.now() - t
}
const LIMIT = 1500

describe('a library of ~1,850 titles and ~5,000 files', () => {
  it('lists pages quickly in every order, and pages through everything', () => {
    for (const sort of ['title', 'added', 'year'] as const) expect(ms(() => titles.list({ sort, limit: 60 })), sort).toBeLessThan(LIMIT)
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      const page = titles.list({ sort: 'title', limit: 200, cursor })
      page.items.forEach((t) => seen.add(t.key))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen.size).toBe(titles.list({ limit: 1 }).total)
  })

  it('describes whole titles even when a search matched only one of their files', () => {
    const series = titles.detail(keys.series)!.summary
    const found = titles.list({ q: series.title.toLowerCase().split(' ')[0]!, kind: 'series', limit: 200 }).items.find((t) => t.key === series.key)!
    expect(found.episodeCount).toBe(series.episodeCount)
    expect(found.fileCount).toBe(series.fileCount)
  })

  it('searches, opens titles, and builds the other lists quickly', () => {
    expect(ms(() => titles.list({ q: 'sil', limit: 60 }))).toBeLessThan(LIMIT)
    expect(ms(() => titles.detail(keys.series))).toBeLessThan(LIMIT)
    expect(ms(() => new CollectionRepo(handle.raw, titles).list())).toBeLessThan(LIMIT)
    expect(ms(() => new PlaybackRepo(handle.raw, titles).continueWatching(20))).toBeLessThan(LIMIT)
  })
})
