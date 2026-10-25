import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { seed } from '../../../tools/perf/seed'

test('large grids keep cards bounded and restore keyboard focus after details', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'theama-render-perf-'))
  const data = join(directory, 'library')
  mkdirSync(data)
  seed(data, { movies: 1200, series: 1, episodesPerSeries: 16, videos: 1 })
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: data, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none', THEAMA_LOG_LEVEL: 'warn' }
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${join(directory, 'profile')}`], cwd: join(import.meta.dirname, '..'), env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string> })
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.waitForSelector('[data-poster-card]')
    await page.evaluate(() => { location.hash = '/movies' })
    const cells = page.locator('[data-grid-index]')
    await expect(cells.first()).toHaveAttribute('aria-setsize', '60')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const measure = async () => {
      await cdp.send('HeapProfiler.collectGarbage')
      const metrics = (await cdp.send('Performance.getMetrics')).metrics
      return { heapMB: metrics.find(metric => metric.name === 'JSHeapUsedSize')!.value / 1048576, ...(await cdp.send('Memory.getDOMCounters')) }
    }
    const initial = await measure()
    const requests = { titlePages: 0, artwork: 0 }
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path === '/api/v1/library/titles') requests.titlePages++
      if (path.startsWith('/api/v1/artwork/')) requests.artwork++
    })
    for (let count = 120; count <= 1200; count += 60) {
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
      await expect(cells.first()).toHaveAttribute('aria-setsize', String(count))
      expect(await cells.count()).toBeLessThan(120)
    }
    const deep = await measure()
    expect(deep.heapMB).toBeLessThan(initial.heapMB + 40)
    expect(deep.nodes).toBeLessThan(initial.nodes + 10000)
    expect(requests.titlePages).toBe(19)
    const frames = await page.evaluate(() => new Promise<{ p95Ms: number; framesOver50Ms: number }>(resolve => {
      const intervals: number[] = []
      const start = performance.now()
      const top = scrollY
      let previous = start
      function tick(now: number): void {
        intervals.push(now - previous)
        previous = now
        scrollTo({ top: Math.max(0, top - (now - start) * 2), behavior: 'instant' })
        if (now - start < 1000) requestAnimationFrame(tick)
        else {
          intervals.sort((a, b) => a - b)
          resolve({ p95Ms: intervals[Math.floor(intervals.length * 0.95)]!, framesOver50Ms: intervals.filter(value => value > 50).length })
        }
      }
      requestAnimationFrame(tick)
    }))
    console.log('Renderer performance:', JSON.stringify({ initial, after20Pages: deep, mountedCards: await cells.count(), frames, requests }))

    const firstLink = cells.first().locator('[data-title-key]')
    await firstLink.focus()
    await page.keyboard.press('Home')
    await expect(page.locator('[data-grid-index="0"] [data-title-key]')).toBeFocused()
    await page.keyboard.press('End')
    const last = page.locator('[data-grid-index="1199"] [data-title-key]')
    await expect(last).toBeFocused()
    const key = await last.getAttribute('data-title-key')
    await last.click()
    await expect(page.locator('.hero')).toBeVisible()
    await page.goBack()
    await expect(page.locator(`[data-title-key="${key}"]`)).toBeFocused()

    const runtime = JSON.parse(readFileSync(join(data, 'runtime.json'), 'utf8')) as { port: number }
    const token = readFileSync(join(data, 'secrets', 'api-token'), 'utf8').trim()
    // Text-size and viewport changes must recompute virtual geometry without overlapping rows.
    for (const width of [480, 1280]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
      await page.evaluate(() => scrollTo(0, 0))
      await expect(page.locator('[data-grid-index="0"]')).toBeVisible()
      expect(await cells.count()).toBeLessThan(120)
    }
    const updated = await fetch(`http://127.0.0.1:${runtime.port}/api/v1/settings`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ textSize: 'extra-large' }) })
    expect(updated.ok).toBe(true)
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThan(16)
    expect(errors).toEqual([])
  } finally {
    await app?.close()
    const withinTemp = relative(tmpdir(), directory)
    if (withinTemp && !withinTemp.startsWith('..') && !isAbsolute(withinTemp)) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
})
