import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
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

// --- backdrop scenes ---------------------------------------------------------------------------

const backdrop = (): ReturnType<Page['locator']> => page.locator('[data-test="immersive-backdrop"]')
const visit = (route: string): Promise<unknown> => page.goto(`${page.url().split('#')[0]}#${route}`)
const patchSettings = (patch: object): Promise<Response> => api('/settings', { method: 'PUT', body: JSON.stringify(patch) })
const SCENE_TIMEOUT = { timeout: 15_000 }

async function openTitle(card: RegExp, route: string): Promise<void> {
  await visit(route)
  await page.getByRole('link', { name: card }).first().click()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
}

test('the original scene stays the default and ignores what is on screen', async () => {
  await patchSettings({ visualMode: 'immersive', graphicsQuality: 'medium', backdropScene: 'classic', backdropByGenre: true, backdropByKind: true })
  await page.reload()
  await expect(backdrop()).toHaveAttribute('data-scene', 'classic', SCENE_TIMEOUT)
  for (const route of ['/', '/movies', '/series', '/search', '/collections']) {
    await visit(route)
    await expect(backdrop()).toHaveAttribute('data-scene', 'classic')
  }
  await openTitle(/Interstellar/, '/movies')
  await expect(backdrop()).toHaveAttribute('data-scene', 'classic')
})

test('Automatic follows movies, series, the genre of a title and the genre filter', async () => {
  problems.length = 0
  await patchSettings({ backdropScene: 'auto' })
  await visit('/')
  await expect(backdrop()).toHaveAttribute('data-scene', 'classic', SCENE_TIMEOUT) // nothing to follow on Home
  await visit('/movies')
  await expect(backdrop()).toHaveAttribute('data-scene', 'movie')
  await visit('/series')
  await expect(backdrop()).toHaveAttribute('data-scene', 'series')

  // A title: its most characteristic genre (Interstellar: Adventure, Drama, Science Fiction -> sci-fi).
  await openTitle(/Interstellar/, '/movies')
  await expect(backdrop()).toHaveAttribute('data-scene', 'scifi')
  await openTitle(/Mad Max/, '/movies')
  await expect(backdrop()).toHaveAttribute('data-scene', 'action')

  // The genre filter on a browsing page.
  await visit('/movies')
  await expect(backdrop()).toHaveAttribute('data-scene', 'movie')
  await page.locator('.genre-filter__select').click()
  await page.getByRole('option', { name: 'Action', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(backdrop()).toHaveAttribute('data-scene', 'action')
  expect(problems, problems.join('\n')).toEqual([])
  // The page remembers its filter while the app runs; start the next test from a clean list.
  await page.reload()
  await expect(page.getByRole('link', { name: /Interstellar/ }).first()).toBeVisible()
})

test('the two follow switches turn the genre and the kind off', async () => {
  await patchSettings({ backdropScene: 'auto', backdropByGenre: false, backdropByKind: true })
  await openTitle(/Interstellar/, '/movies')
  await expect(backdrop()).toHaveAttribute('data-scene', 'movie') // the kind, not the genre
  await patchSettings({ backdropByGenre: true, backdropByKind: false })
  await expect(backdrop()).toHaveAttribute('data-scene', 'scifi')
  await visit('/movies')
  await expect(backdrop()).toHaveAttribute('data-scene', 'classic') // no genre on the page, and the kind is off
  await patchSettings({ backdropByGenre: true, backdropByKind: true })
})

test('a scene chosen by hand is used on every page', async () => {
  await patchSettings({ backdropScene: 'horror' })
  for (const route of ['/', '/movies', '/series']) {
    await visit(route)
    await expect(backdrop()).toHaveAttribute('data-scene', 'horror', SCENE_TIMEOUT)
  }
  await openTitle(/Interstellar/, '/movies')
  await expect(backdrop()).toHaveAttribute('data-scene', 'horror')
})

test('the gallery in Settings previews every scene and saves the choice', async () => {
  problems.length = 0
  await patchSettings({ visualMode: 'immersive', backdropScene: 'classic' })
  await visit('/settings/general')
  const gallery = page.locator('[data-test="backdrop-gallery"]')
  await expect(gallery).toBeVisible({ timeout: 15_000 })
  // Classic, Automatic and the 16 others; 17 of them have a thumbnail (Automatic has none).
  await expect(gallery.getByRole('radio')).toHaveCount(18)
  await expect(page.locator('[data-test="backdrop-classic"]')).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('[data-test="backdrop-by-genre"] input')).toBeDisabled() // only meaningful on Automatic

  // Every thumbnail gets drawn (one shared WebGL renderer, copied into each card).
  await expect
    .poll(
      () =>
        page.locator('[data-test="backdrop-gallery"] canvas').evaluateAll((els) =>
          els.filter((el) => {
            const c = el as HTMLCanvasElement
            const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
            const first = [data[0], data[1], data[2]].join()
            for (let i = 4; i < data.length; i += 4) if ([data[i], data[i + 1], data[i + 2]].join() !== first) return true
            return false
          }).length,
        ),
      { timeout: 30_000 },
    )
    .toBe(17)

  await page.locator('[data-test="backdrop-horror"]').click()
  await expect(backdrop()).toHaveAttribute('data-scene', 'horror', SCENE_TIMEOUT)
  await expect.poll(async () => ((await (await api('/settings')).json()) as { backdropScene: string }).backdropScene).toBe('horror')

  await page.locator('[data-test="backdrop-auto"]').click()
  await expect(page.locator('[data-test="backdrop-by-genre"] input')).toBeEnabled()
  await expect.poll(async () => ((await (await api('/settings')).json()) as { backdropScene: string }).backdropScene).toBe('auto')
  await page.locator('[data-test="backdrop-by-genre"] input').click({ force: true })
  await expect.poll(async () => ((await (await api('/settings')).json()) as { backdropByGenre: boolean }).backdropByGenre).toBe(false)
  await patchSettings({ backdropByGenre: true })

  // Arrow keys move between the cards, and Classic restores the default.
  await page.locator('[data-test="backdrop-auto"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-test="backdrop-movie"]')).toBeFocused() // after Automatic comes the first scene in catalogue order
  await page.locator('[data-test="backdrop-classic"]').click()
  await expect(backdrop()).toHaveAttribute('data-scene', 'classic', SCENE_TIMEOUT)
  await expect.poll(async () => ((await (await api('/settings')).json()) as { backdropScene: string }).backdropScene).toBe('classic')
  expect(problems, problems.join('\n')).toEqual([])
})

test('the gallery passes an accessibility audit and is a proper radio group', async () => {
  await patchSettings({ visualMode: 'immersive', backdropScene: 'classic' })
  await visit('/settings/general')
  const gallery = page.locator('[data-test="backdrop-gallery"]')
  await expect(gallery).toBeVisible({ timeout: 15_000 })
  await expect(gallery.getByRole('radiogroup', { name: 'Backdrop scene' })).toBeVisible()
  // Exactly one stop in the tab order, so tabbing past 18 cards is a single keystroke.
  await expect(gallery.locator('[role="radio"][tabindex="0"]')).toHaveCount(1)
  await expect(gallery.getByRole('radio', { name: /Horror/ })).toBeVisible() // named from its text

  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8')
  await page.evaluate(axeSource)
  await page.waitForTimeout(500) // thumbnails settle
  const found = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(ctx: Element, options: object): Promise<{ violations: { id: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe
    const result = await axe.run(document.querySelector('[data-test="backdrop-gallery"]')!, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`)
  })
  expect(found.join('\n')).toBe('')
  await patchSettings({ visualMode: 'standard' })
})
