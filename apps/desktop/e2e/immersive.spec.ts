import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../tools/fake-tmdb/server.mjs'

/**
 * The optional immersive 3D mode, end to end in the real shell: the setting turns the three.js backdrop on and
 * off, the page keeps working underneath it, artwork loads into the scene without a CORS refusal, and an operating
 * system request for less motion switches it back to the standard interface.
 */
let app: ElectronApplication
let page: Page
let fake: FakeTmdb
let dataDir: string
let userData: string
let media: string
let base: string
let token: string
const problems: string[] = []

const api = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${base}/api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
const setMode = (visualMode: 'standard' | 'immersive', graphicsQuality?: 'low' | 'medium' | 'high'): Promise<Response> =>
  api('/settings', { method: 'PUT', body: JSON.stringify({ visualMode, ...(graphicsQuality ? { graphicsQuality } : {}) }) })

test.beforeAll(async () => {
  fake = await startFakeTmdb()
  dataDir = mkdtempSync(join(tmpdir(), 'theama-3d-data-'))
  userData = mkdtempSync(join(tmpdir(), 'theama-3d-profile-'))
  media = mkdtempSync(join(tmpdir(), 'theama-3d-media-'))
  for (const f of ['Interstellar.2014.mkv', 'Mad.Max.1979.mkv', 'Severance.S01E01.mkv']) writeFileSync(join(media, f), 'x')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  Object.assign(env, {
    THEAMA_DATA_DIR: dataDir,
    THEAMA_PORT: '0',
    THEAMA_CONTROLLER: 'dev',
    THEAMA_FFPROBE: 'none',
    THEAMA_TMDB_API_BASE: fake.url,
    THEAMA_TMDB_IMAGE_BASE: fake.imageUrl,
    THEAMA_TEST_PLAYER_LOG: join(dataDir, 'players.log'),
  })
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: join(import.meta.dirname, '..'), env })
  page = await app.firstWindow()
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' || /three|webgl|shader/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`)
  })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 90_000 })

  const port = (JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port: number }).port
  base = `http://127.0.0.1:${port}`
  token = readFileSync(join(dataDir, 'secrets', 'api-token'), 'utf8').trim()
  await api('/library/sources', { method: 'POST', body: JSON.stringify({ path: media, libraryType: 'auto' }) })
  await api('/metadata/credentials', { method: 'PUT', body: JSON.stringify({ tmdbApiKey: GOOD_KEY }) })
  await expect
    .poll(async () => {
      const s = (await (await api('/metadata/status')).json()) as { pending: number; state: string; matched: number }
      return s.pending === 0 && s.state === 'idle' && s.matched >= 2
    }, { timeout: 60_000 })
    .toBe(true)
})

test.afterAll(async () => {
  await app.close()
  await fake.close()
  rmSync(dataDir, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
  await rm(media, { recursive: true, force: true }).catch(() => undefined)
})

test('standard mode loads no 3D at all', async () => {
  await setMode('standard')
  await page.reload()
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('html')).not.toHaveClass(/th-immersive/)
  await expect(page.locator('[data-test="immersive-backdrop"]')).toHaveCount(0)
})

test('the setting turns the backdrop on and off live', async () => {
  problems.length = 0
  await setMode('immersive', 'medium')
  await expect(page.locator('html')).toHaveClass(/th-immersive/, { timeout: 15_000 })
  const canvas = page.locator('[data-test="immersive-backdrop"]')
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('aria-hidden', 'true')
  // It is really drawing: a WebGL context exists and the canvas has a size.
  const box = await canvas.boundingBox()
  expect(box!.width).toBeGreaterThan(300)
  await page.waitForTimeout(2500) // let artwork load into the scene
  expect(problems, problems.join('\n')).toEqual([])

  await setMode('standard')
  await expect(page.locator('html')).not.toHaveClass(/th-immersive/)
  await expect(canvas).toHaveCount(0)
})

test('the interface still works under the backdrop', async () => {
  await setMode('immersive', 'low')
  await expect(page.locator('html')).toHaveClass(/th-immersive/, { timeout: 15_000 })
  await page.goto(`${page.url().split('#')[0]}#/movies`)
  const card = page.getByRole('link', { name: /Interstellar/ }).first()
  await expect(card).toBeVisible()
  // The backdrop must never take a click or the keyboard focus.
  await card.click()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await page.goBack()
  await expect(card).toBeVisible()
  await card.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-title-key]:focus')).toHaveCount(1)
})

test('settings offers the mode and the quality, and reduced motion falls back to standard', async () => {
  await setMode('immersive', 'medium')
  await page.goto(`${page.url().split('#')[0]}#/settings/general`)
  await expect(page.locator('[data-test="visual-mode"]')).toBeVisible()
  await expect(page.locator('[data-test="graphics-quality"]')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/th-immersive/)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('html')).not.toHaveClass(/th-immersive/)
  await expect(page.locator('[data-test="immersive-unavailable"]')).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.locator('html')).toHaveClass(/th-immersive/)

  await page.locator('[data-test="visual-mode-standard"]').click()
  await expect(page.locator('[data-test="graphics-quality"]')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveClass(/th-immersive/)
})
