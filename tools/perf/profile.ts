/**
 * Times the library queries directly (no HTTP) on a synthetic 5,000-title database that is kept between runs,
 * so a change to a query can be measured in seconds:   yarn tsx tools/perf/profile.ts
 */
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { openDatabase } from '../../apps/server/src/db/client'
import { CollectionRepo } from '../../apps/server/src/collections/store'
import { MetadataRepo } from '../../apps/server/src/metadata/store'
import { PlaybackRepo } from '../../apps/server/src/playback/store'
import { TitleRepo } from '../../apps/server/src/scan/titles'
import { FULL, seed } from './seed'

const dir = join(tmpdir(), 'theama-perf-profile')
const dbFile = join(dir, 'data', 'theama.db')
let keys = { series: '', movie: '' }
if (!existsSync(dbFile)) {
  mkdirSync(dir, { recursive: true })
  const t = performance.now()
  keys = seed(dir, FULL).keys
  console.log(`seeded in ${((performance.now() - t) / 1000).toFixed(1)} s`)
}
const h = openDatabase(dbFile)
if (!keys.series) {
  keys.series = (h.raw.prepare("SELECT title_key AS k FROM media_file WHERE kind = 'episode' LIMIT 1").get() as { k: string }).k
  keys.movie = (h.raw.prepare("SELECT title_key AS k FROM media_file WHERE kind = 'movie' LIMIT 1").get() as { k: string }).k
}
const titles = new TitleRepo(h.raw, new MetadataRepo(h.raw))
const collections = new CollectionRepo(h.raw, titles)
const playback = new PlaybackRepo(h.raw, titles)

function bench(name: string, runs: number, fn: () => unknown): void {
  fn()
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    samples.push(performance.now() - t)
  }
  samples.sort((a, b) => a - b)
  console.log(`${name.padEnd(36)} p50 ${samples[Math.floor(runs / 2)]!.toFixed(1).padStart(7)} ms   p95 ${samples[Math.floor(runs * 0.95)]!.toFixed(1).padStart(7)} ms`)
}

bench('list A–Z', 20, () => titles.list({ sort: 'title', limit: 60 }))
bench('list recently added', 20, () => titles.list({ sort: 'added', limit: 60 }))
bench('list by year', 20, () => titles.list({ sort: 'year', limit: 60 }))
bench('list series only', 20, () => titles.list({ kind: 'series', limit: 60 }))
bench('search "sil"', 20, () => titles.list({ q: 'sil', limit: 60 }))
bench('search "golden r"', 20, () => titles.list({ q: 'golden r', limit: 60 }))
bench('search "the"', 20, () => titles.list({ q: 'the', limit: 60 }))
bench('detail series', 20, () => titles.detail(keys.series))
bench('detail film', 20, () => titles.detail(keys.movie))
bench('collections list', 10, () => collections.list())
bench('continue watching', 10, () => playback.continueWatching(20))
h.close()
