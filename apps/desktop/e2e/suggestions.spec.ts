import { dismissInitialSetup } from './setup-helper'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type Route } from '@playwright/test'
import type { DownloadItem, Suggestion } from '@theama/contracts'
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
let suggestionsHandler: ((route: Route) => Promise<void>) | null = null
let suggestionRequests: URL[] = []
let searchRequests: URL[] = []
let releaseHandler: ((route: Route) => Promise<void>) | null = null

const longTitle = 'Clayface: A very long movie title that must wrap without hiding the rating'
const overview = 'Matt Hagen’s meteoric rise from Gotham street kid to Hollywood leading man is tragically cut short when a local crime boss leaves him horribly disfigured. '
const movie: Suggestion = { provider: 'tmdb', externalId: '157336', kind: 'movie', title: 'Interstellar', originalTitle: null, year: 2014, overview: 'A team of explorers travel through a wormhole in space.', posterUrl: null, score: null, rating: 8.4, genres: ['Adventure', 'Science Fiction'] }
const items: Suggestion[] = [
  { ...movie, externalId: '501', title: longTitle, year: 2026, overview: overview.repeat(24), rating: 7.6 },
  movie,
  { ...movie, externalId: '95396', kind: 'series', title: 'Severance', year: 2022, overview: 'Mark leads a team of office workers whose memories have been surgically divided.', genres: ['Drama'] },
  { ...movie, externalId: '700001', title: 'Obscure Gem', year: null, overview: null, rating: null },
]
const downloadItems: DownloadItem[] = [
  { hash: 'a', name: 'Twin Zeta', state: 'paused', progress: 0.2, downloadSpeed: 0, size: 1000, eta: null, kind: 'movie', own: true, addedAt: '2026-01-03T00:00:00Z' },
  { hash: 'b', name: 'Twin Alpha', state: 'paused', progress: 0.4, downloadSpeed: 0, size: 2000, eta: null, kind: 'movie', own: true, addedAt: '2026-01-02T00:00:00Z' },
  { hash: 'c', name: 'Twin Live', state: 'downloading', progress: 0.6, downloadSpeed: 100, size: 3000, eta: 60, kind: 'series', own: true, addedAt: '2026-01-04T00:00:00Z' },
  { hash: 'd', name: 'Other Movie', state: 'paused', progress: 0.8, downloadSpeed: 0, size: 4000, eta: null, kind: 'movie', own: true, addedAt: '2026-01-01T00:00:00Z' },
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

async function navigateAwayAndBack(): Promise<void> {
  // Include valid release-search parameters on another page to catch outgoing route watchers.
  await page.goto(`${page.url().split('#')[0]}#/movies?kind=series&title=Other&season=9`)
  await expect(page.locator('h1')).toHaveText('Movies')
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Downloads', exact: true }).click()
  await expect(page.locator('h1')).toHaveText('Downloads')
}

test.beforeAll(async () => {
  fake = await startFakeTmdb()
  dataDir = mkdtempSync(join(tmpdir(), 'theama-suggestions-data-'))
  userData = mkdtempSync(join(tmpdir(), 'theama-suggestions-profile-'))
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none', THEAMA_TEST_TRAILER_URL: 'data:text/html,<title>fake trailer</title><body style="background:%23123">', THEAMA_TMDB_API_BASE: fake.url, THEAMA_TMDB_IMAGE_BASE: fake.imageUrl }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: join(import.meta.dirname, '..'), env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string> })
  page = await app.firstWindow()
  await dismissInitialSetup(page)
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
    const url = new URL(route.request().url())
    suggestionRequests.push(url)
    if (suggestionsHandler) return suggestionsHandler(route)
    const selected = url.searchParams.get('genres')?.split('|') ?? []
    const filtered = items.filter((c) => selected.length === 0 || (url.searchParams.get('genreMode') === 'all'
      ? selected.every((genre) => c.genres?.includes(genre)) : selected.some((genre) => c.genres?.includes(genre))))
    await route.fulfill({ json: { items: url.searchParams.get('section') === 'new' ? filtered : [], hasMore: false } })
  })
  await page.route(/\/api\/v1\/metadata\/suggestions\/details\?/, async (route) => {
    detailsRequests += 1
    if (detailsHandler) return detailsHandler(route)
    if (new URL(route.request().url()).searchParams.get('externalId') === '700001') {
      await route.fulfill({ json: { imdbId: null, trailer: null } })
    } else await route.continue()
  })
  await page.route(/\/api\/v1\/metadata\/search\?/, async (route) => {
    const url = new URL(route.request().url())
    searchRequests.push(url)
    const kind = url.searchParams.get('kind')
    const year = url.searchParams.get('year')
    await route.fulfill({ json: { items: (kind === 'movie' ? [movie] : [items[2]!]).filter(c => !year || String(c.year) === year) } })
  })
  await page.route(/\/api\/v1\/downloads\/releases\?/, async (route) => {
    releaseRequests.push(new URL(route.request().url()))
    if (releaseHandler) return releaseHandler(route)
    await route.fulfill({ status: 503, json: { error: { code: 'not_configured', message: 'Test indexer is not configured.' } } })
  })
  await page.route(/\/api\/v1\/downloads$/, async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: { reachable: true, items: downloadItems } })
    else await route.continue()
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
  searchRequests = []
  releaseHandler = null
  detailsHandler = null
  suggestionsHandler = null
  suggestionRequests = []
  await resize(1100)
  expect((await api('/settings', { theme: 'dark', language: 'en' })).ok).toBe(true)
  await page.goto(`${page.url().split('#')[0]}#/downloads`)
  // Reusing a hash URL does not reload Vue; reset each test's filter, preview and metadata cache.
  await page.reload()
  await expect(card('Interstellar')).toBeVisible()
})

test('Find and Favorites filters survive page navigation and reset on reload', async () => {
  const genre = page.locator('[data-test="find-genre"]')
  await page.locator('[data-test="suggestion-filter-movie"]').click()
  await page.locator('[data-test="find-title"] input').fill('Remember this title')
  await page.getByRole('combobox', { name: 'Years', exact: true }).fill('2014')
  await page.getByRole('option', { name: '2014', exact: true }).click()
  await page.keyboard.press('Escape')
  await genre.locator('.v-select .v-field').click()
  await page.getByRole('option', { name: 'Drama', exact: true }).click()
  await page.getByRole('option', { name: 'Science Fiction', exact: true }).click()
  await page.keyboard.press('Escape')
  await genre.getByRole('button', { name: 'All', exact: true }).click()
  await page.locator('[data-test="find-rating"] [role="slider"]').first().focus()
  await page.keyboard.press('ArrowRight')

  await navigateAwayAndBack()
  await expect(page.locator('[data-test="tab-find"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-test="suggestion-filter-movie"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-test="find-title"] input')).toHaveValue('Remember this title')
  await expect(page.locator('[data-test="find-year"] .v-chip')).toHaveText(['2014'])
  await expect(genre.locator('.v-chip')).toHaveText(['Drama', 'Science Fiction'])
  await expect(genre.getByRole('button', { name: 'All', exact: true })).toHaveClass(/v-btn--active/)
  await expect(page.locator('[data-test="find-rating"]')).toContainText('0.1–10.0')

  await page.locator('[data-test="suggestion-filter-series"]').click()
  await page.locator('[data-test="find-season"] input').fill('2')
  await page.locator('[data-test="find-episode"] input').fill('3')
  await navigateAwayAndBack()
  await expect(page.locator('[data-test="suggestion-filter-series"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-test="find-season"] input')).toHaveValue('2')
  await expect(page.locator('[data-test="find-episode"] input')).toHaveValue('3')

  await page.locator('[data-test="tab-favorites"]').click()
  await page.locator('[data-test="favorites-filter-series"]').click()
  await navigateAwayAndBack()
  await expect(page.locator('[data-test="tab-favorites"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-test="favorites-filter-series"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('[data-test="tab-find"]').click()
  await expect(page.locator('[data-test="find-title"] input')).toHaveValue('Remember this title')
  await expect(genre.locator('.v-chip')).toHaveText(['Drama'])

  await page.reload()
  await expect(page.locator('[data-test="tab-find"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-test="suggestion-filter-all"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-test="find-title"] input')).toHaveValue('')
  await expect(genre.locator('.v-chip')).toHaveCount(0)
  await expect(genre.getByRole('button', { name: 'Any', exact: true })).toHaveClass(/v-btn--active/)
  await expect(page.locator('[data-test="find-rating"]')).toContainText('0.0–10.0')
  await page.locator('[data-test="suggestion-filter-movie"]').click()
  await expect(page.locator('[data-test="find-year"] .v-chip')).toHaveCount(0)
  await page.locator('[data-test="suggestion-filter-series"]').click()
  await expect(page.locator('[data-test="find-season"] input')).toHaveValue('')
  await expect(page.locator('[data-test="find-episode"] input')).toHaveValue('')
  await page.locator('[data-test="tab-favorites"]').click()
  await expect(page.locator('[data-test="favorites-filter-all"]')).toHaveAttribute('aria-pressed', 'true')
})

async function selectYears(...years: number[]): Promise<void> {
  for (const year of years) {
    await page.getByRole('combobox', { name: 'Years', exact: true }).fill(String(year))
    await page.getByRole('option', { name: String(year), exact: true }).click()
    await page.keyboard.press('Escape')
  }
}

async function switchTab(tab: string): Promise<void> {
  // Do not scroll to the header before clicking: verify the pane's actual saved position.
  await page.locator(`[data-test="tab-${tab}"]`).evaluate((el: HTMLElement) => el.click())
}

async function expectScroll(y: number): Promise<void> {
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - y)).toBeLessThan(2)
}

test('loaded pages, expanded years and separate scroll positions survive tabs, navigation and releases', async () => {
  suggestionsHandler = async (route) => {
    const url = new URL(route.request().url())
    const fresh = url.searchParams.get('section') === 'new'
    const pageNumber = Number(url.searchParams.get('page'))
    const year = fresh ? 2026 : Number(url.searchParams.get('year'))
    const count = fresh ? 20 : 4
    const entries = Array.from({ length: count }, (_, i) => ({ ...movie, year, genres: ['Drama'], externalId: `${year}${pageNumber}${i}`, title: `${fresh ? 'Fresh' : year} title ${pageNumber}-${i}` }))
    await route.fulfill({ json: { items: entries, hasMore: fresh && pageNumber === 1 } })
  }
  const genre = page.locator('[data-test="find-genre"]')
  await genre.locator('.v-select .v-field').click()
  await page.getByRole('option', { name: 'Drama', exact: true }).click()
  await page.keyboard.press('Escape')
  const section = page.locator('[data-test="suggestion-section"]').first()
  await expect(section.locator('[data-test="suggestion-item"]')).toHaveCount(20)
  await section.locator('[data-test="suggestion-more"]').click()
  await expect(section.locator('[data-test="suggestion-item"]')).toHaveCount(40)
  await page.locator('[data-test="suggestion-years-sentinel"]').scrollIntoViewIfNeeded()
  await expect.poll(() => page.locator('[data-test="suggestion-section"]').count()).toBeGreaterThan(6)
  await page.evaluate(() => window.scrollTo(0, 1100))
  await expectScroll(1100)
  const expanded = await page.locator('[data-test="suggestion-section"]').count()
  const titles = await section.locator('.card__title').allTextContents()
  const newRequests = () => suggestionRequests.filter(url => url.searchParams.get('section') === 'new').length
  const before = newRequests()
  await navigateAwayAndBack()
  await expect(section.locator('.card__title')).toHaveText(titles)
  await expectScroll(1100)
  expect(await page.locator('[data-test="suggestion-section"]').count()).toBe(expanded)
  expect(newRequests()).toBe(before)
  await switchTab('favorites')
  await expectScroll(0)
  await switchTab('find')
  await expectScroll(1100)
  await switchTab('active')
  await expectScroll(0)
  await switchTab('find')
  await expectScroll(1100)
  expect(newRequests()).toBe(before)

  releaseHandler = async (route) => {
    await route.fulfill({ json: { source: 'prowlarr', received: 50, items: Array.from({ length: 50 }, (_, i) => ({
      id: `release-${i}`, title: `Fresh title 1-0 ${i}.1080p`, size: 1000, seeders: i + 1, leechers: 0, indexer: 'Test', resolution: '1080p', quality: 'WEB-DL', codec: null, season: null, episode: null, pack: false,
    })) } })
  }
  await card('Fresh title 1-0').click()
  const browseY = await page.evaluate(() => window.scrollY)
  await page.locator('[data-test="suggestion-releases"]').click()
  await expect(page.locator('[data-test="release-list"] .release')).toHaveCount(50)
  await page.locator('[data-test="release-sort"]').click()
  await page.getByRole('option', { name: 'Most seeders', exact: true }).click()
  await page.locator('[data-test="release-min-seeders"] input').fill('5')
  await page.locator('[data-test="release-title"] input').fill('Draft title')
  await expect(page.locator('[data-test="release-list"] .release')).toHaveCount(46)
  await page.evaluate(() => window.scrollTo(0, 700))
  await expectScroll(700)
  await switchTab('active')
  await switchTab('find')
  await expectScroll(700)
  await navigateAwayAndBack()
  await expectScroll(700)
  await expect(page.locator('[data-test="release-sort"]')).toContainText('Most seeders')
  await expect(page.locator('[data-test="release-min-seeders"] input')).toHaveValue('5')
  await expect(page.locator('[data-test="release-title"] input')).toHaveValue('Draft title')
  await expect(page.locator('[data-test="release-list"] .release')).toHaveCount(46)
  expect(releaseRequests).toHaveLength(1)
  await page.locator('[data-test="releases-back"]').evaluate((el: HTMLElement) => el.click())
  await expect(section.locator('.card__title')).toHaveText(titles)
  await expectScroll(browseY)
  expect(newRequests()).toBe(before)
})

test('multiple years and rating bounds filter suggestions and search results and survive navigation', async () => {
  const unrated = { ...movie, externalId: 'unrated', title: 'Unrated', rating: null }
  const lower = { ...movie, externalId: 'lower', title: 'Lower rated', rating: 2 }
  suggestionsHandler = async (route) => {
    const url = new URL(route.request().url())
    const year = Number(url.searchParams.get('year'))
    const matching = [movie, items[2]!, unrated, lower].filter(c => c.year === year)
    await route.fulfill({ json: { items: matching, hasMore: false } })
  }
  await selectYears(2014, 2022)
  await expect(page.locator('[data-test="suggestion-section"] h2')).toHaveText(['From 2022', 'From 2014'])
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(4)
  await expect(page.locator('[data-test="suggestion-years-sentinel"]')).toHaveCount(0)
  const sliders = page.locator('[data-test="find-rating"] [role="slider"]')
  await sliders.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(card('Unrated')).toHaveCount(0)
  await sliders.last().focus()
  for (let i = 0; i < 17; i++) await page.keyboard.press('ArrowLeft')
  await expect(page.locator('[data-test="find-rating"]')).toContainText('0.1–8.3')
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(1)
  await expect(card('Lower rated')).toBeVisible()
  expect(suggestionRequests.at(-1)!.searchParams.get('ratingMax')).toBe('8.3')
  await page.locator('[data-test="find-rating-reset"]').click()
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(4)

  await page.locator('[data-test="find-title"] input').fill('a')
  await page.locator('[data-test="find-search"]').click()
  await expect(page.locator('[data-test="match-list"] [data-test="suggestion-item"]')).toHaveCount(2)
  expect(searchRequests.map(url => [url.searchParams.get('kind'), url.searchParams.get('year')])).toEqual([
    ['movie', '2022'], ['series', '2022'], ['movie', '2014'], ['series', '2014'],
  ])
  const before = searchRequests.length
  await navigateAwayAndBack()
  await expect(page.locator('[data-test="match-list"] [data-test="suggestion-item"]')).toHaveCount(2)
  await expect(page.locator('[data-test="find-year"] .v-chip')).toHaveText(['2014', '2022'])
  expect(searchRequests).toHaveLength(before)
  await page.locator('[data-test="suggestion-filter-series"]').click()
  await expect(page.locator('[data-test="match-list"] [data-test="suggestion-item"]')).toHaveCount(1)
  await expect(card('Severance')).toBeVisible()
  await page.locator('[data-test="find-title"] input').fill('')
  await page.locator('[data-test="find-year"]').getByRole('button', { name: /clear/i }).click()
  await expect(page.locator('[data-test="find-year"] .v-chip')).toHaveCount(0)
  await expect(page.locator('[data-test="suggestion-years-sentinel"]')).toHaveCount(1)
  await expect.poll(() => suggestionRequests.at(-1)?.searchParams.get('section') === 'new'
    || suggestionRequests.some(url => url.searchParams.get('section') === 'new' && !url.searchParams.has('year'))).toBe(true)
  await resize(360)
  expect(await page.locator('.find__row').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('direct searches without metadata use a year only when exactly one year is selected', async () => {
  expect((await api('/metadata/credentials', { tmdbApiKey: null })).ok).toBe(true)
  try {
    await expect(page.locator('[data-test="find-genre"]')).toHaveCount(0)
    await page.locator('[data-test="suggestion-filter-movie"]').click()
    await selectYears(2014)
    await page.locator('[data-test="find-title"] input').fill('Direct title')
    await page.locator('[data-test="find-search"]').click()
    await expect.poll(() => releaseRequests.length).toBe(1)
    expect(releaseRequests[0]!.searchParams.get('year')).toBe('2014')
    await page.locator('[data-test="releases-back"]').click()
    await selectYears(2022)
    await page.locator('[data-test="find-search"]').click()
    await expect.poll(() => releaseRequests.length).toBe(2)
    expect(releaseRequests[1]!.searchParams.has('year')).toBe(false)
    expect(searchRequests).toHaveLength(0)
  } finally { expect((await api('/metadata/credentials', { tmdbApiKey: GOOD_KEY })).ok).toBe(true) }
})

test('the Releases mode can be opened on its own and searched with any title, and Suggestions is one click away', async () => {
  const mode = (name: 'suggestions' | 'releases') => page.locator(`[data-test="find-mode-${name}"]`)
  await expect(mode('suggestions')).toHaveAttribute('aria-pressed', 'true')

  // A title typed among the suggestions carries over, and no TMDB lookup is made.
  await page.locator('[data-test="find-title"] input').fill('Shine')
  await mode('releases').click()
  await expect(mode('releases')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-test="find-releases-hint"]')).toBeVisible()
  await expect(page.locator('[data-test="find-genre"]')).toHaveCount(0)
  await expect(page.locator('[data-test="find-rating"]')).toHaveCount(0)
  await expect(page.locator('[data-test="find-title"] input')).toHaveValue('Shine')
  expect(releaseRequests).toHaveLength(0)
  await page.locator('[data-test="find-release-year"] input').fill('1996')
  await page.locator('[data-test="find-search"]').click()
  await expect.poll(() => releaseRequests.length).toBe(2)
  expect(searchRequests).toHaveLength(0)
  expect(releaseRequests.map(url => url.searchParams.get('title'))).toEqual(['Shine', 'Shine'])
  expect(releaseRequests.find(url => url.searchParams.get('kind') === 'movie')!.searchParams.get('year')).toBe('1996')
  await expect(page.locator('[data-test="release-title"] input').first()).toHaveValue('Shine')
  await expect(mode('releases')).toHaveAttribute('aria-pressed', 'true')

  // Both the switch and the labeled back button return to the suggestions.
  await mode('suggestions').click()
  await expect(card('Interstellar')).toBeVisible()
  await expect(page.locator('[data-test="release-search"]')).toHaveCount(0)

  // Coming back restores the last search without asking Prowlarr again.
  await mode('releases').click()
  await expect(page.locator('[data-test="release-title"] input').first()).toHaveValue('Shine')
  expect(releaseRequests).toHaveLength(2)
  await expect(page.locator('[data-test="releases-back"]').first()).toContainText('suggestions')
  await page.locator('[data-test="releases-back"]').first().click()
  await expect(mode('suggestions')).toHaveAttribute('aria-pressed', 'true')
  await expect(card('Interstellar')).toBeVisible()
})

test('person lists retain their context and loaded titles and apply years and ratings to both kinds', async () => {
  let requests = 0
  const handler = async (route: Route) => { requests++; await route.continue() }
  await page.route(/\/api\/v1\/metadata\/person\/titles\?/, handler)
  try {
    await page.goto(`${page.url().split('#')[0]}#/downloads?personId=42&personCategory=actor&personName=Test`)
    await expect(page.locator('[data-test="person-suggestions"] [data-test="suggestion-item"]')).toHaveCount(20)
    await selectYears(2020, 2021)
    await page.locator('[data-test="find-rating"] [role="slider"]').first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('[data-test="person-suggestions"] [data-test="suggestion-item"]')).toHaveCount(10)
    await navigateAwayAndBack()
    await expect(page.locator('[data-test="person-suggestions"] h2')).toContainText('Test')
    await expect(page.locator('[data-test="person-suggestions"] [data-test="suggestion-item"]')).toHaveCount(10)
    expect(requests).toBe(1)
    await page.goBack()
    await expect(page.locator('h1')).toHaveText('Movies')
    await page.goBack()
    await expect(page.locator('[data-test="person-suggestions"] [data-test="suggestion-item"]')).toHaveCount(10)
    expect(requests).toBe(1)
    await page.locator('[data-test="suggestion-filter-series"]').click()
    await expect(page.locator('[data-test="person-suggestions-empty"]')).toBeVisible()
    await page.locator('[data-test="find-rating-reset"]').click()
    await expect(page.locator('[data-test="person-suggestions"] [data-test="suggestion-item"]')).toHaveCount(10)
    await card('Series 0').click()
    await page.locator('[data-test="suggestion-releases"]').click()
    await expect(page.locator('[data-test="release-error"]')).toBeVisible()
    await page.locator('[data-test="releases-back"]').click()
    await expect(page.locator('[data-test="find-year"] .v-chip')).toHaveText(['2020', '2021'])
    await expect(page.locator('[data-test="person-suggestions"] [data-test="suggestion-item"]')).toHaveCount(10)
    expect(requests).toBe(1)
    await page.goto(`${page.url().split('#')[0]}#/movies`)
    await expect(page.locator('h1')).toHaveText('Movies')
    // Use an application navigation: native hash assignments reuse Vue Router's history position.
    await page.evaluate(async () => {
      const root = document.querySelector('#app') as HTMLElement & {
        __vue_app__: { config: { globalProperties: { $router: { push(path: string): Promise<unknown> } } } }
      }
      await root.__vue_app__.config.globalProperties.$router.push('/downloads?personId=42&personCategory=actor&personName=Test')
    })
    await expect(page.locator('[data-test="person-suggestions"] [data-test="suggestion-item"]')).toHaveCount(20)
    await expect(page.locator('[data-test="find-year"] .v-chip')).toHaveCount(0)
    expect(requests).toBe(2)
    await page.locator('[data-test="person-back"]').click()
    await expect(page.locator('[data-test="person-suggestions"]')).toHaveCount(0)
    await expect(card('Interstellar')).toBeVisible()
  } finally { await page.unroute(/\/api\/v1\/metadata\/person\/titles\?/, handler) }
})

test('Active filters and sorting survive navigation, clearing persists, and reload restores defaults', async () => {
  const names = page.locator('[data-test="download-list"] .card__name')
  const search = page.locator('[data-test="downloads-search"] input')
  const sort = page.locator('[data-test="downloads-sort"]')
  const direction = page.locator('[data-test="downloads-sort-direction"]')
  await page.locator('[data-test="tab-active"]').click()
  await search.fill('Twin')
  await page.locator('[data-test="filter-paused"]').click()
  await sort.click()
  await page.getByRole('option', { name: 'Name', exact: true }).click()
  await direction.click()
  await expect(names).toHaveText(['Twin Alpha', 'Twin Zeta'])

  await navigateAwayAndBack()
  await expect(page.locator('[data-test="tab-active"]')).toHaveAttribute('aria-selected', 'true')
  await expect(search).toHaveValue('Twin')
  await expect(page.locator('[data-test="filter-paused"]')).toHaveClass(/v-chip--selected/)
  await expect(sort).toContainText('Name')
  await expect(direction).toHaveAttribute('aria-label', 'Ascending. Click for descending.')
  await expect(names).toHaveText(['Twin Alpha', 'Twin Zeta'])
  await page.locator('[data-test="tab-find"]').click()
  await page.locator('[data-test="tab-active"]').click()
  await expect(names).toHaveText(['Twin Alpha', 'Twin Zeta'])

  await search.fill('No matching download')
  await page.locator('[data-test="downloads-no-match"]').getByRole('button', { name: 'Clear filters' }).click()
  await navigateAwayAndBack()
  await expect(search).toHaveValue('')
  await expect(page.locator('[data-test="filter-all"]')).toHaveClass(/v-chip--selected/)
  await expect(sort).toContainText('Name')
  await expect(direction).toHaveAttribute('aria-label', 'Ascending. Click for descending.')
  await expect(names).toHaveText(['Other Movie', 'Twin Alpha', 'Twin Live', 'Twin Zeta'])

  // Leave nondefault search and status values so reload checks every Active control.
  await search.fill('Twin')
  await page.locator('[data-test="filter-paused"]').click()
  await page.reload()
  await expect(page.locator('[data-test="tab-find"]')).toHaveAttribute('aria-selected', 'true')
  await page.locator('[data-test="tab-active"]').click()
  await expect(search).toHaveValue('')
  await expect(page.locator('[data-test="filter-all"]')).toHaveClass(/v-chip--selected/)
  await expect(sort).toContainText('Newest')
  await expect(direction).toHaveAttribute('aria-label', 'Descending. Click for ascending.')
  await expect(names).toHaveText(['Twin Live', 'Twin Zeta', 'Twin Alpha', 'Other Movie'])
})

test('explicit title and person links start Find without resetting Favorites or Active filters', async () => {
  await page.locator('[data-test="suggestion-filter-series"]').click()
  await page.locator('[data-test="find-title"] input').fill('Old title')
  await page.locator('[data-test="find-season"] input').fill('7')
  await page.locator('[data-test="find-episode"] input').fill('8')
  const genre = page.locator('[data-test="find-genre"]')
  await genre.locator('.v-select .v-field').click()
  await page.getByRole('option', { name: 'Drama', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.locator('[data-test="tab-favorites"]').click()
  await page.locator('[data-test="favorites-filter-series"]').click()
  await page.locator('[data-test="tab-active"]').click()
  await page.locator('[data-test="downloads-search"] input').fill('Twin')
  await page.locator('[data-test="filter-paused"]').click()

  await page.goto(`${page.url().split('#')[0]}#/downloads?kind=movie&title=Interstellar&year=2014&releases=1`)
  await expect(page.locator('[data-test="tab-find"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-test="release-title"] input')).toHaveValue('Interstellar')
  await expect(page.locator('[data-test="release-year"] input')).toHaveValue('2014')
  await expect.poll(() => releaseRequests.length).toBe(1)
  await page.locator('[data-test="releases-back"]').click()
  await expect(page.locator('[data-test="suggestion-filter-movie"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(genre.locator('.v-chip')).toHaveCount(0)

  await page.goto(`${page.url().split('#')[0]}#/downloads?personId=525&personCategory=director&personName=Christopher%20Nolan`)
  await expect(page.locator('[data-test="person-suggestions"] h2')).toHaveText('Movies and TV series directed by Christopher Nolan')
  await expect(page.locator('[data-test="tab-find"]')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-test="suggestion-filter-all"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-test="find-title"] input')).toHaveValue('')
  await expect(genre.locator('.v-chip')).toHaveCount(0)
  await page.locator('[data-test="suggestion-filter-movie"]').click()
  await expect(page.locator('[data-test="find-year"] .v-chip')).toHaveCount(0)
  await page.locator('[data-test="suggestion-filter-series"]').click()
  await expect(page.locator('[data-test="find-season"] input')).toHaveValue('')
  await expect(page.locator('[data-test="find-episode"] input')).toHaveValue('')
  await page.locator('[data-test="tab-favorites"]').click()
  await expect(page.locator('[data-test="favorites-filter-series"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('[data-test="tab-active"]').click()
  await expect(page.locator('[data-test="downloads-search"] input')).toHaveValue('Twin')
  await expect(page.locator('[data-test="filter-paused"]')).toHaveClass(/v-chip--selected/)
  await expect(page.locator('[data-test="download-list"] .card__name')).toHaveText(['Twin Zeta', 'Twin Alpha'])
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
  await expect(page.locator('[data-test="suggestion-filter"]')).toHaveCount(1)
  await expect(toggle.getByRole('button')).toHaveText(['All', 'Series', 'Movies'])
  for (const filter of ['all', 'series', 'movie']) {
    await page.locator(`[data-test="suggestion-filter-${filter}"]`).click()
    const boxes = await Promise.all([toggle.boundingBox(), field.boundingBox(), page.locator('[data-test="find-search"]').boundingBox()])
    const centers = boxes.map((box) => box!.y + box!.height / 2)
    expect(Math.max(...centers) - Math.min(...centers), JSON.stringify({ filter, boxes })).toBeLessThan(3)
  }
  await page.locator('[data-test="suggestion-filter-all"]').click()
  await genre.locator('.v-select .v-field').click()
  await page.getByRole('option', { name: 'Drama', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(1)
  await expect(card('Severance')).toBeVisible()
  await page.locator('[data-test="find-title"] input').fill('a')
  await page.locator('[data-test="find-search"]').click()
  await expect(page.locator('[data-test="match-list"]')).toBeVisible()
  await expect(card('Severance')).toBeVisible()
  await expect(card('Interstellar')).toHaveCount(0)
  await genre.getByRole('button', { name: /clear/i }).click()
  await expect(page.locator('[data-test="match-list"] [data-test="suggestion-item"]')).toHaveCount(2)
  await expect(page.locator('[data-test="match-list"] [data-test="suggestion-rating"]').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('search-toolbar.png') })
  await page.locator('[data-test="match-direct"]').click()
  await expect.poll(() => releaseRequests.length).toBe(2)
  expect(releaseRequests.map((url) => url.searchParams.get('kind')).sort()).toEqual(['movie', 'series'])
  await resize(360)
  await expect(page.locator('.rel__bar')).toHaveCount(2)
  for (const bar of await page.locator('.rel__bar').all()) {
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
})

test('genres refetch full matching pages and Show more keeps filters and removes duplicates', async () => {
  const discovered = { ...movie, externalId: '800001', title: 'Discovered Drama', genres: ['Drama', 'Science Fiction'] }
  const next = { ...discovered, externalId: '800002', title: 'More Drama' }
  let failNextPage = true
  suggestionsHandler = async (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('section') === 'new' && params.get('page') === '2' && failNextPage) {
      failNextPage = false
      await route.fulfill({ status: 503, json: { error: { code: 'unreachable', message: 'Page unavailable' } } })
      return
    }
    const result = params.get('section') !== 'new' ? [] : params.get('page') === '2' ? [discovered, next, next] : [items[2], discovered]
    await route.fulfill({ json: { items: result, hasMore: params.get('section') === 'new' && params.get('page') === '1' } })
  }
  const genre = page.locator('[data-test="find-genre"]')
  await genre.locator('.v-select .v-field').click()
  // Thriller is available in the catalog even though none of the initial cards has it.
  await expect(page.getByRole('option', { name: 'Thriller', exact: true })).toHaveCount(1)
  await page.getByRole('option', { name: 'Drama', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(card(discovered.title)).toBeVisible()
  const section = page.locator('[data-test="suggestion-section"]').first()
  await expect(section.locator('[data-test="suggestion-item"]')).toHaveCount(2)
  await section.locator('[data-test="suggestion-more"]').click()
  await expect(section.locator('[data-test="suggestion-error"]')).toContainText('Page unavailable')
  await expect(section.locator('[data-test="suggestion-item"]')).toHaveCount(2)
  await section.locator('[data-test="suggestion-retry"]').click()
  await expect(section.locator('[data-test="suggestion-item"]')).toHaveCount(3)
  await expect(section.locator('[data-test="suggestion-more"]')).toHaveCount(0)
  expect(suggestionRequests.filter((url) => url.searchParams.get('section') === 'new').slice(-3).map((url) => [url.searchParams.get('page'), url.searchParams.get('genres')])).toEqual([['1', 'Drama'], ['2', 'Drama'], ['2', 'Drama']])

  // Removing a chip resets pagination to page one and restores unfiltered results.
  suggestionsHandler = null
  await genre.locator('.v-chip').getByRole('button', { name: /close/i }).click()
  await expect(card('Interstellar')).toBeVisible()
  await expect(section.locator('[data-test="suggestion-item"]')).toHaveCount(4)
  expect(suggestionRequests.filter((url) => url.searchParams.get('section') === 'new').at(-1)?.searchParams.get('page')).toBe('1')
})

test('multiple genres use Any and All consistently for suggestions and title search matches', async () => {
  const genre = page.locator('[data-test="find-genre"]')
  await genre.locator('.v-select .v-field').click()
  await page.getByRole('option', { name: 'Drama', exact: true }).click()
  await page.getByRole('option', { name: 'Science Fiction', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(4)
  expect(suggestionRequests.filter((url) => url.searchParams.get('section') === 'new').at(-1)?.searchParams.get('genres')).toBe('Drama|Science Fiction')
  await resize(360)
  expect(await page.locator('.find__row').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await genre.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await resize(1100)
  await genre.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.locator('[data-test="suggestion-section"]').first()).toContainText('No suggestions match these filters.')
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(0)
  expect(suggestionRequests.filter((url) => url.searchParams.get('section') === 'new').at(-1)?.searchParams.get('genreMode')).toBe('all')
  await page.locator('[data-test="find-title"] input').fill('a')
  await page.locator('[data-test="find-search"]').click()
  await expect(page.locator('.find__body')).toContainText('TMDB found nothing for this search.')
  await genre.getByRole('button', { name: 'Any', exact: true }).click()
  await expect(page.locator('[data-test="match-list"] [data-test="suggestion-item"]')).toHaveCount(2)
  await genre.getByRole('button', { name: /clear/i }).click()
  await page.locator('[data-test="find-title"] input').fill('')
  await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(4)
})

test('the full genre catalog can be retried after a failed lookup', async () => {
  const catalogRoute = '**/api/v1/metadata/genres'
  await page.route(catalogRoute, async (route) => {
    await route.fulfill({ status: 503, json: { error: { code: 'unreachable', message: 'Genre catalog unavailable' } } })
  })
  try {
    await page.reload()
    await expect(page.locator('[data-test="genre-error"]')).toContainText('Genre catalog unavailable')
    await page.unroute(catalogRoute)
    await page.locator('[data-test="genre-error"]').getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('[data-test="genre-error"]')).toHaveCount(0)
    await page.locator('[data-test="find-genre"] .v-select .v-field').click()
    await expect(page.getByRole('option', { name: 'Comedy', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    await page.unroute(catalogRoute)
  }
})

for (const staleOutcome of ['results', 'error'] as const) {
  test(`rapid genre changes ignore late ${staleOutcome} and failed pages can be retried`, async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    suggestionsHandler = async (route) => {
      const params = new URL(route.request().url()).searchParams
      if (params.get('section') === 'new' && params.get('genres') === 'Drama') {
        await pending
        await route.fulfill(staleOutcome === 'error'
          ? { status: 503, json: { error: { code: 'unreachable', message: 'Stale provider error' } } }
          : { json: { items: [items[2]], hasMore: true } })
      } else await route.fulfill({ json: { items: params.get('section') === 'new' ? [movie] : [], hasMore: false } })
    }
    const genre = page.locator('[data-test="find-genre"]')
    await genre.locator('.v-select .v-field').click()
    await page.getByRole('option', { name: 'Drama', exact: true }).click()
    await expect.poll(() => suggestionRequests.some((url) => url.searchParams.get('section') === 'new' && url.searchParams.get('genres') === 'Drama')).toBe(true)
    const cancelled = page.waitForEvent('requestfailed', request => {
      const params = new URL(request.url()).searchParams
      return params.get('genres') === 'Drama' && params.get('section') === 'new'
    })
    await page.getByRole('option', { name: 'Adventure', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(card('Interstellar')).toBeVisible()
    expect((await cancelled).failure()?.errorText).toContain('ERR_ABORTED')
    finish()
    await expect(page.locator('[data-test="suggestion-item"]')).toHaveCount(1)
    await expect(page.locator('[data-test="suggestion-error"]')).toHaveCount(0)
    await expect(page.getByText('Stale provider error')).toHaveCount(0)

    suggestionsHandler = async (route) => {
      await route.fulfill({ status: 503, json: { error: { code: 'unreachable', message: 'Provider offline' } } })
    }
    await genre.getByRole('button', { name: /clear/i }).click()
    const section = page.locator('[data-test="suggestion-section"]').first()
    await expect(section.locator('[data-test="suggestion-error"]')).toContainText('Provider offline')
    suggestionsHandler = null
    await section.locator('[data-test="suggestion-retry"]').click()
    await expect(card('Interstellar')).toBeVisible()
    await expect(section.locator('[data-test="suggestion-error"]')).toHaveCount(0)
  })
}

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
  await expect(page.locator('[data-test="suggestion-detail-rating"]')).toContainText('8.4')
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
    // The mobile layout keeps a compact poster beside the synopsis.
    await expect(page.locator('.details__poster')).toBeVisible()
    expect((await page.locator('.details__poster').boundingBox())!.width).toBeLessThan(120)
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
