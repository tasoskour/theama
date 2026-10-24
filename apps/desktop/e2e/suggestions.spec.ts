import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type Route } from '@playwright/test'
import type { Suggestion } from '@theama/contracts'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../tools/fake-tmdb/server.mjs'

let app: ElectronApplication
let page: Page
let fake: FakeTmdb
let dataDir: string
let userData: string
let base: string
let token: string
let detailsRequests = 0
let releaseRequests: URL[] = []
let detailsHandler: ((route: Route) => Promise<void>) | null = null

const longTitle = 'Clayface: A very long movie title that must wrap without hiding the rating'
const overview = 'Matt Hagen’s meteoric rise from Gotham street kid to Hollywood leading man is tragically cut short when a local crime boss leaves him horribly disfigured. '
const movie: Suggestion = { provider: 'tmdb', externalId: '157336', kind: 'movie', title: 'Interstellar', originalTitle: null, year: 2014, overview: 'A team of explorers travel through a wormhole in space.', posterUrl: null, score: null, rating: 8.4, genres: ['Adventure', 'Science Fiction'] }
const items: Suggestion[] = [
  { ...movie, externalId: '501', title: longTitle, year: 2026, overview: overview.repeat(24), rating: 7.6 },
  movie,
  { ...movie, externalId: '95396', kind: 'series', title: 'Severance', year: 2022, overview: 'Mark leads a team of office workers whose memories have been surgically divided.', genres: ['Drama'] },
  { ...movie, externalId: '700001', title: 'Obscure Gem', year: null, overview: null, rating: null },
]
const card = (title: string) => page.locator('[data-test="suggestion-item"]').filter({ hasText: title })
const dialog = () => page.locator('[data-test="suggestion-dialog"]')
const api = (path: string, body: object) => fetch(`${base}/api/v1${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const request = (method: string, path: string, body?: object) => fetch(`${base}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })

async function resize(width: number, height = 850): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.setMinimumSize(0, 0)
    win.setContentSize(size.width, size.height)
  }, { width, height })
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
}

test.beforeAll(async () => {
  fake = await startFakeTmdb()
  dataDir = mkdtempSync(join(tmpdir(), 'theama-suggestions-data-'))
  userData = mkdtempSync(join(tmpdir(), 'theama-suggestions-profile-'))
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none', THEAMA_TEST_TRAILER_URL: 'data:text/html,<title>fake trailer</title><body style="background:%23123">', THEAMA_TMDB_API_BASE: fake.url, THEAMA_TMDB_IMAGE_BASE: fake.imageUrl }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: join(import.meta.dirname, '..'), env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string> })
  page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  const port = (JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port: number }).port
  base = `http://127.0.0.1:${port}`
  token = readFileSync(join(dataDir, 'secrets', 'api-token'), 'utf8').trim()
  expect((await api('/metadata/credentials', { tmdbApiKey: GOOD_KEY })).ok).toBe(true)
  // Capture external links without opening the user's browser.
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    Object.assign(globalThis, { suggestionExternalLinks: opened })
    shell.openExternal = async (url) => { opened.push(url) }
  })
  await page.route(/\/api\/v1\/metadata\/suggestions\?/, async (route) => {
    const section = new URL(route.request().url()).searchParams.get('section')
    await route.fulfill({ json: { items: section === 'new' ? items : [], hasMore: false } })
  })
  await page.route(/\/api\/v1\/metadata\/suggestions\/details\?/, async (route) => {
    detailsRequests += 1
    if (detailsHandler) return detailsHandler(route)
    if (new URL(route.request().url()).searchParams.get('externalId') === '700001') {
      await route.fulfill({ json: { imdbId: null, trailer: null } })
    } else await route.continue()
  })
  await page.route(/\/api\/v1\/metadata\/search\?/, async (route) => {
    const kind = new URL(route.request().url()).searchParams.get('kind')
    await route.fulfill({ json: { items: kind === 'movie' ? [movie] : [items[2]] } })
  })
  await page.route(/\/api\/v1\/downloads\/releases\?/, async (route) => {
    releaseRequests.push(new URL(route.request().url()))
    await route.fulfill({ status: 503, json: { error: { code: 'not_configured', message: 'Test indexer is not configured.' } } })
  })
})

test.afterAll(async () => {
  await app?.close()
  await fake?.close()
  // Only remove the exact temporary directories created by this fixture.
  for (const path of [dataDir, userData]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-suggestions-(data|profile)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
})

test.beforeEach(async () => {
  detailsRequests = 0
  releaseRequests = []
  detailsHandler = null
  await resize(1100)
  expect((await api('/settings', { theme: 'dark', language: 'en' })).ok).toBe(true)
  await page.goto(`${page.url().split('#')[0]}#/downloads`)
  // Reusing a hash URL does not reload Vue; reset each test's filter, preview and metadata cache.
  await page.reload()
  await expect(card('Interstellar')).toBeVisible()
})

test('library badges update after identification, hiding and removal', async () => {
  const media = join(dataDir, 'badge-media')
  mkdirSync(media, { recursive: true })
  writeFileSync(join(media, 'Interstellar.2014.mkv'), 'x')
  const response = await request('POST', '/library/sources', { path: media, libraryType: 'movies', recursive: true })
  expect(response.ok).toBe(true)
  const source = await response.json() as { id: number }
  try {
    await expect(card('Interstellar').locator('[data-test="suggestion-added"]')).toBeVisible()
    await card('Interstellar').click()
    await expect(page.locator('[data-test="suggestion-detail-added"]')).toHaveText('Already added')
    await page.keyboard.press('Escape')
    const titles = await (await request('GET', '/library/titles')).json() as { items: { key: string }[] }
    expect((await request('POST', '/library/titles/hide', { key: titles.items[0]!.key })).ok).toBe(true)
    await expect(card('Interstellar').locator('[data-test="suggestion-added"]')).toHaveCount(0)
  } finally {
    expect((await request('DELETE', `/library/sources/${source.id}`)).ok).toBe(true)
  }
  await expect(card('Interstellar').locator('[data-test="suggestion-added"]')).toHaveCount(0)
})

test('favorites sync between cards and dialogs, persist, filter and search releases', async () => {
  const heart = (title: string) => card(title).locator('..').locator('[data-test="suggestion-favorite"]')
  await heart('Interstellar').focus()
  await page.keyboard.press('Enter')
  await expect(heart('Interstellar')).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog()).toHaveCount(0)
  expect(releaseRequests).toHaveLength(0)
  await card('Interstellar').click()
  await expect(page.locator('[data-test="suggestion-detail-favorite"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('[data-test="suggestion-detail-favorite"]').click()
  await expect(page.locator('[data-test="suggestion-detail-favorite"]')).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await expect(heart('Interstellar')).toHaveAttribute('aria-pressed', 'false')
  await heart('Interstellar').click()
  await expect(heart('Interstellar')).toHaveAttribute('aria-pressed', 'true')
  await heart('Severance').click()
  await expect(heart('Severance')).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await page.locator('[data-test="tab-favorites"]').click()
  const favorites = page.locator('[data-test="favorites-section"]')
  await expect(favorites.locator('[data-test="suggestion-item"]')).toHaveText([/Severance/, /Interstellar/])
  await page.locator('[data-test="favorites-filter-movie"]').click()
  await expect(favorites.locator('[data-test="suggestion-item"]')).toHaveCount(1)
  await page.locator('[data-test="favorites-filter-series"]').click()
  await expect(favorites.locator('[data-test="suggestion-item"]')).toHaveText([/Severance/])
  await favorites.locator('[data-test="suggestion-item"]').click()
  await page.locator('[data-test="suggestion-releases"]').click()
  await expect(page.locator('[data-test="tab-find"]')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => releaseRequests.length).toBe(1)
  expect(releaseRequests[0]!.searchParams.get('kind')).toBe('series')
  for (const item of [movie, items[2]!]) {
    expect((await request('DELETE', `/downloads/favorites/${item.provider}/${item.kind}/${item.externalId}`)).ok).toBe(true)
  }
  await page.locator('[data-test="tab-favorites"]').click()
  await expect(page.locator('[data-test="favorites-empty"]')).toBeVisible()
})

test('saved favorites work without a metadata key, fit mobile, and retry failed saves', async ({ browserName: _browserName }, testInfo) => {
  const heart = card('Interstellar').locator('..').locator('[data-test="suggestion-favorite"]')
  const pattern = /\/api\/v1\/downloads\/favorites$/
  await page.route(pattern, async (route) => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Save failed' } } })
    else await route.continue()
  })
  await heart.click()
  await expect(page.locator('[data-test="favorites-error"]')).toContainText('Save failed')
  await expect(heart).toHaveAttribute('aria-pressed', 'false')
  await page.unroute(pattern)
  await page.locator('[data-test="favorites-retry"]').click()
  await expect(heart).toHaveAttribute('aria-pressed', 'true')
  expect((await api('/metadata/credentials', { tmdbApiKey: null })).ok).toBe(true)
  try {
    await page.reload()
    await page.locator('[data-test="tab-favorites"]').click()
    const favorites = page.locator('[data-test="favorites-section"]')
    await expect(favorites.locator('[data-test="suggestion-item"]')).toHaveText([/Interstellar/])
    await resize(360)
    expect(await favorites.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('favorites-mobile.png') })
    await page.evaluate(readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8'))
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run(context: string, options: object): Promise<{ violations: unknown[] }> } }).axe
      return (await axe.run('[data-test="favorites-section"]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations
    })
    expect(violations).toEqual([])
    await favorites.locator('[data-test="suggestion-item"]').click()
    await expect(dialog().getByRole('heading')).toHaveText('Interstellar')
    await page.locator('[data-test="suggestion-detail-favorite"]').click()
    await expect(page.locator('[data-test="suggestion-detail-favorite"]')).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-test="favorites-empty"]')).toBeVisible()
    await expect(page.locator('[data-test="tab-favorites"]')).toBeFocused()
  } finally {
    expect((await api('/metadata/credentials', { tmdbApiKey: GOOD_KEY })).ok).toBe(true)
  }
})

test('one type filter shares the search row and genres filter suggestions and mixed search results', async ({ browserName: _browserName }, testInfo) => {
  const toggle = page.locator('[data-test="suggestion-filter"]')
  const field = page.locator('[data-test="find-title"]')
  const genre = page.locator('[data-test="find-genre"]')
  await expect(page.locator('.find .v-btn-toggle')).toHaveCount(1)
  await expect(toggle.getByRole('button')).toHaveText(['All', 'Series', 'Movies'])
  for (const filter of ['all', 'series', 'movie']) {
    await page.locator(`[data-test="suggestion-filter-${filter}"]`).click()
    const boxes = await Promise.all([toggle.boundingBox(), field.boundingBox(), genre.boundingBox(), page.locator('[data-test="find-search"]').boundingBox()])
    const centers = boxes.map((box) => box!.y + box!.height / 2)
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(3)
  }
  await page.locator('[data-test="suggestion-filter-all"]').click()
  await genre.click()
  await page.getByRole('option', { name: 'Drama', exact: true }).click()
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(1)
  await expect(card('Severance')).toBeVisible()
  await page.locator('[data-test="find-title"] input').fill('a')
  await page.locator('[data-test="find-search"]').click()
  await expect(page.locator('[data-test="match-list"]')).toBeVisible()
  await expect(card('Severance')).toBeVisible()
  await expect(card('Interstellar')).toHaveCount(0)
  await genre.getByRole('button', { name: /clear/i }).click()
  await expect(page.locator('[data-test="match-list"] [data-test="suggestion-item"]')).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('search-toolbar.png') })
  await page.locator('[data-test="match-direct"]').click()
  await expect.poll(() => releaseRequests.length).toBe(2)
  expect(releaseRequests.map((url) => url.searchParams.get('kind')).sort()).toEqual(['movie', 'series'])
  await resize(360)
  expect(await page.locator('.find__row').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('cards open details without searching, retain keyboard focus, and preserve type filtering', async () => {
  await card(longTitle).hover()
  await expect(page.locator('[data-test="suggestion-description"]')).toHaveCount(0)
  await expect(page.locator('[data-test="suggestion-trailer"]')).toHaveCount(0)
  await expect(card(longTitle).locator('[data-test="suggestion-rating"]')).toHaveText('7.6')
  await card(longTitle).focus()
  await page.keyboard.press('Enter')
  await expect(dialog()).toBeVisible()
  await expect(dialog().getByRole('heading')).toHaveText(longTitle)
  await expect(dialog().locator('[data-test="suggestion-description"]')).toHaveText(overview.repeat(24).trim())
  expect(detailsRequests).toBe(0)
  expect(releaseRequests).toHaveLength(0)
  await page.locator('[data-test="suggestion-imdb"]').focus()
  await page.keyboard.press('Tab')
  await expect(page.locator('[data-test="suggestion-close"]')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('[data-test="suggestion-imdb"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog()).not.toBeVisible()
  await expect(card(longTitle)).toBeFocused()
  await card('Interstellar').click()
  await expect(dialog()).toBeVisible()
  await page.mouse.click(5, 100)
  await expect(dialog()).not.toBeVisible()
  await expect(card('Interstellar')).toBeFocused()
  await page.locator('[data-test="suggestion-filter-series"]').click()
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(1)
  await expect(card('Severance')).toBeVisible()
  await page.locator('[data-test="suggestion-filter-movie"]').click()
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(3)
})

test('release searches require the explicit action for suggestions and search results', async () => {
  await card('Severance').click()
  await page.locator('[data-test="suggestion-releases"]').click()
  await expect(dialog()).not.toBeVisible()
  await expect.poll(() => releaseRequests.length).toBe(1)
  expect(releaseRequests[0]!.searchParams.get('kind')).toBe('series')
  expect(releaseRequests[0]!.searchParams.get('title')).toBe('Severance')
  await page.locator('[data-test="releases-back"]').click()
  await page.locator('[data-test="suggestion-filter-movie"]').click()
  await page.locator('[data-test="find-title"] input').fill('Interstellar')
  await page.locator('[data-test="find-search"]').click()
  await expect(page.locator('[data-test="match-list"]')).toBeVisible()
  await card('Interstellar').click()
  await expect(dialog()).toBeVisible()
  await expect(page.locator('[data-test="suggestion-detail-rating"]')).toHaveCount(0)
  expect(releaseRequests).toHaveLength(1)
  await page.locator('[data-test="suggestion-releases"]').click()
  await expect.poll(() => releaseRequests.length).toBe(2)
  expect(releaseRequests[1]!.searchParams.get('kind')).toBe('movie')
  expect(releaseRequests[1]!.searchParams.get('year')).toBe('2014')
})

test('trailer playback stacks over details and IMDb uses the existing external link', async () => {
  await card('Interstellar').click()
  await page.locator('[data-test="suggestion-trailer"]').click()
  await expect(page.locator('[data-test="trailer-dialog"]')).toBeVisible()
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-test="trailer-dialog"]')).not.toBeVisible()
  await expect(dialog()).toBeVisible()
  await expect(page.locator('[data-test="suggestion-trailer"]')).toBeFocused()
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(0)
  await page.locator('[data-test="suggestion-imdb"]').click()
  await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { suggestionExternalLinks: string[] }).suggestionExternalLinks)).toContain('https://www.imdb.com/title/tt0816692/')
  expect(detailsRequests).toBe(1) // the metadata store reuses the trailer lookup
  await expect(dialog()).toBeVisible()
})

test('missing content and lookup failures remain in the selected title dialog', async () => {
  await card('Obscure Gem').click()
  await expect(page.locator('[data-test="suggestion-description"]')).toHaveText('No description available.')
  await expect(page.locator('[data-test="suggestion-detail-rating"]')).toHaveCount(0)
  await page.locator('[data-test="suggestion-trailer"]').click()
  await expect(page.locator('[data-test="suggestion-link-error"]')).toHaveText('No trailer available')
  await page.locator('[data-test="suggestion-imdb"]').click()
  await expect(page.locator('[data-test="suggestion-link-error"]')).toHaveText('No IMDb page available')
  await page.keyboard.press('Escape')
  detailsHandler = async (route) => { await route.fulfill({ status: 503, json: { error: { code: 'unreachable', message: 'Provider offline' } } }) }
  await card(longTitle).click()
  await expect(page.locator('[data-test="suggestion-link-error"]')).toHaveCount(0)
  await page.locator('[data-test="suggestion-imdb"]').click()
  await expect(page.locator('[data-test="suggestion-link-error"]')).toContainText('Provider offline')
  await expect(dialog()).toBeVisible()
})

test('dismissing a pending lookup prevents stale playback and errors in another preview', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  detailsHandler = async (route) => {
    await pending
    await route.fulfill({ json: { imdbId: 'tt0816692', trailer: { site: 'youtube', key: 'zSWdZVtXT7E' } } })
  }
  await card(longTitle).click()
  await page.locator('[data-test="suggestion-trailer"]').click()
  await expect.poll(() => detailsRequests).toBe(1)
  await expect(page.locator('[data-test="suggestion-imdb"]')).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog()).not.toBeVisible()
  await card('Obscure Gem').click()
  const response = page.waitForResponse(/\/metadata\/suggestions\/details\?/)
  finish()
  await response
  // Round-trip the renderer after it handles the response.
  await expect(page.locator('[data-test="suggestion-imdb"]')).toBeEnabled()
  await expect(dialog().getByRole('heading')).toHaveText('Obscure Gem')
  await expect(page.locator('[data-test="trailer-dialog"]')).toHaveCount(0)
  await expect(page.locator('[data-test="suggestion-link-error"]')).toHaveCount(0)
})

for (const [theme, language] of [['dark', 'en'], ['light', 'en'], ['dark', 'el'], ['light', 'el']] as const) {
  test(`details fit desktop and 360px touch layouts and pass accessibility: ${theme}, ${language}`, async ({ browserName: _browserName }, testInfo) => {
    expect((await api('/settings', { theme, language })).ok).toBe(true)
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    await expect(page.locator('.v-application')).toHaveClass(new RegExp(theme === 'dark' ? 'v-theme--theamaDark' : 'v-theme--theamaLight'))
    await card(longTitle).click()
    await expect(dialog()).toBeVisible()
    await expect(page.locator('.details__poster')).toBeVisible()
    const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8')
    await page.evaluate(axeSource)
    for (const width of [1100, 360]) {
      await resize(width)
      await expect(page.locator('[data-test="suggestion-description"]')).toHaveCSS('font-size', '16px')
      const body = page.locator('[data-test="suggestion-body"]')
      await body.evaluate((el) => { el.scrollTop = 0 })
      await page.screenshot({ path: testInfo.outputPath(width === 360 ? 'mobile.png' : 'desktop.png') })
      expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
      await body.evaluate((el) => { el.scrollTop = el.scrollHeight })
      const button = await page.locator('[data-test="suggestion-releases"]').boundingBox()
      expect(button!.y + button!.height).toBeLessThan(850)
      expect(await dialog().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run(context: string, options: object): Promise<{ violations: { id: string; help: string; nodes: { html: string }[] }[] }> } }).axe
        return (await axe.run('.suggestion-dialog', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations
      })
      expect(violations).toEqual([])
    }
    await expect(page.locator('.details__poster')).not.toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog()).not.toBeVisible()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    // Send real touch input through Chromium without relying on a mouse hover.
    await card('Obscure Gem').scrollIntoViewIfNeeded()
    const target = (await card('Obscure Gem').boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x + target.width / 2, y: target.y + target.height / 2 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
    await expect(dialog()).toBeVisible()
    await expect(page.locator('[data-test="suggestion-description"]')).toHaveText(language === 'en' ? 'No description available.' : 'Δεν υπάρχει διαθέσιμη περιγραφή.')
    await page.locator('[data-test="suggestion-close"]').click()
    await expect(dialog()).not.toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })
}
