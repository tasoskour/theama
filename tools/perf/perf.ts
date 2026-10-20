/**
 * Performance check against the budgets in docs/10-testing-strategy.md §4.
 *
 *   yarn perf            # 5,000 titles / ~20,000 files, then a scan of 10,000 files on disk
 *   yarn perf --small    # a quick run (for checking the script itself)
 *
 * Everything happens in a temporary folder; nothing of yours is read or changed.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { startServer, type RunningServer } from '../../apps/server/src/bootstrap'
import { loadConfig } from '../../apps/server/src/config'
import { FULL, SMALL, seed } from './seed'

const small = process.argv.includes('--small')
const SCAN_FILES = small ? 800 : 10_000

interface Stat {
  name: string
  p50: number
  p95: number
  max: number
  budget?: number
}
const stats: Stat[] = []
const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!

async function time(name: string, runs: number, fn: (i: number) => Promise<unknown>, budget?: number): Promise<number[]> {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    await fn(i)
    samples.push(performance.now() - t)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  stats.push({ name, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), max: sorted.at(-1)!, budget })
  return samples
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'theama-perf-'))
  let server: RunningServer | null = null
  try {
    const dataDir = join(root, 'data')
    mkdirSync(dataDir, { recursive: true })
    const t0 = performance.now()
    const { keys } = seed(dataDir, small ? SMALL : FULL)
    console.log(`Seeding took ${((performance.now() - t0) / 1000).toFixed(1)} s`)

    const started = performance.now()
    server = await startServer(loadConfig({ THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_FFPROBE: 'none', THEAMA_LOG_LEVEL: 'warn' }))
    const startup = performance.now() - started
    const base = `http://127.0.0.1:${server.port}/api/v1`
    const headers = { Authorization: `Bearer ${server.token}` }
    const get = async (path: string): Promise<unknown> => (await fetch(`${base}${path}`, { headers })).json()

    await get('/health') // warm the connection
    const RUNS = small ? 20 : 60
    await time('titles: first page, A–Z', RUNS, () => get('/library/titles?sort=title&limit=60'), 150)
    await time('titles: first page, recently added', RUNS, () => get('/library/titles?sort=added&limit=60'), 150)
    await time('titles: first page, by year', RUNS, () => get('/library/titles?sort=year&limit=60'), 150)
    await time('titles: series only', RUNS, () => get('/library/titles?kind=series&limit=60'), 150)
    await time('titles: hide unavailable', RUNS, () => get('/library/titles?hideUnavailable=true&limit=60'), 150)

    let cursor: string | null = null
    const pages = await time('titles: next pages (deep scroll)', small ? 10 : 40, async () => {
      const page = (await get(`/library/titles?sort=title&limit=60${cursor ? `&cursor=${cursor}` : ''}`)) as { nextCursor: string | null }
      cursor = page.nextCursor
    }, 150)
    void pages

    const queries = ['sil', 'golden r', 'the', 'electric', 'hollow s', 'ταινια', 'νυχτα', 'x', 'a', 'island 2']
    await time('search (prefix, mixed)', RUNS, (i) => get(`/library/titles?q=${encodeURIComponent(queries[i % queries.length]!)}&limit=60`), 100)
    await time('title page: series with episodes', RUNS, () => get(`/library/title?key=${encodeURIComponent(keys.series)}`), 150)
    await time('title page: film', RUNS, () => get(`/library/title?key=${encodeURIComponent(keys.movie)}`), 150)
    await time('continue watching', RUNS, () => get('/playback/continue?limit=20'), 150)
    await time('collections list', RUNS, () => get('/collections'), 150)
    await time('files list (technical)', RUNS, () => get('/library/files?limit=100'), 150)

    const mb = Math.round(process.memoryUsage().rss / 1024 / 1024)

    // --- API latency while a big scan runs ------------------------------------------------------
    const scanDir = join(root, 'scan')
    const FOLDERS = 200
    for (let f = 0; f < FOLDERS; f++) {
      const dir = join(scanDir, `Season ${f}`)
      mkdirSync(dir, { recursive: true })
      for (let i = 0; i < SCAN_FILES / FOLDERS; i++) writeFileSync(join(dir, `Scan.Show.${f}.S01E${String(i + 1).padStart(2, '0')}.1080p.WEB-DL.mkv`), '')
    }
    const during: number[] = []
    const add = await fetch(`${base}/library/sources`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: scanDir, libraryType: 'series' }) })
    if (!add.ok) throw new Error(`could not add the scan folder: ${add.status}`)
    const scanStart = performance.now()
    for (;;) {
      const t = performance.now()
      await get(`/library/titles?sort=added&limit=60&q=${encodeURIComponent('sil')}`)
      during.push(performance.now() - t)
      const t2 = performance.now()
      const status = (await get('/library/status')) as { scanning: boolean }
      during.push(performance.now() - t2)
      if (!status.scanning && performance.now() - scanStart > 500) break
      if (performance.now() - scanStart > 180_000) throw new Error('the scan took longer than three minutes')
      await new Promise((r) => setTimeout(r, 10))
    }
    const scanSeconds = (performance.now() - scanStart) / 1000
    const sorted = [...during].sort((a, b) => a - b)
    stats.push({ name: `API while scanning ${SCAN_FILES} files`, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), max: sorted.at(-1)!, budget: 50 })

    // --- report -----------------------------------------------------------------------------------
    const line = (s: Stat): string => `${s.name.padEnd(42)} p50 ${s.p50.toFixed(1).padStart(7)} ms   p95 ${s.p95.toFixed(1).padStart(7)} ms   max ${s.max.toFixed(1).padStart(7)} ms   ${s.budget === undefined ? '' : s.p95 <= s.budget ? `ok (budget ${s.budget} ms)` : `OVER BUDGET (${s.budget} ms)`}`
    console.log('\n' + stats.map(line).join('\n'))
    console.log(`\nService start-up to listening: ${startup.toFixed(0)} ms (budget 2000 ms for start-up to an interactive shell)`)
    console.log(`Scan of ${SCAN_FILES} files: ${scanSeconds.toFixed(1)} s; memory of this process: ${mb} MB`)
    const over = stats.filter((s) => s.budget !== undefined && s.p95 > s.budget)
    if (over.length > 0) process.exitCode = 1
  } finally {
    await server?.stop('perf finished')
    await rm(root, { recursive: true, force: true })
  }
}

await main()
