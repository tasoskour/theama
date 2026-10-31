import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type Route } from '@playwright/test'
import type { Suggestion, TitleSummary } from '@theama/contracts'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../tools/fake-tmdb/server.mjs'

let app: ElectronApplication
let page: Page
let fake: FakeTmdb
let dataDir: string
let userData: string
let base: string
let token: string
let current: TitleSummary
let related: TitleSummary
let personRequests: URL[] = []
let releaseRequests: URL[] = []
let metadataSearches = 0
let generalSuggestionRequests = 0
let personHandler: ((route: Route) => Promise<void>) | null = null
let navigation = 0
const items: Suggestion[] = (['movie', 'series'] as const).flatMap((kind) => Array.from({ length: 10 }, (_, i) => ({
  provider: 'tmdb', externalId: `${kind === 'movie' ? 8000 : 9000}${i}`, kind,
  title: `${kind === 'movie' ? 'Movie' : 'Series'} ${i}`, year: i ? null : 2020,
  originalTitle: null, overview: null, posterUrl: null, score: null, rating: i ? null : 8.4,
})))
const popup = () => page.locator('[data-test="credit-popover"]:visible')
const actor = () => page.locator('[data-test="credit-actor"]').first()
const director = () => page.locator('[data-test="credit-director"]').first()
const request = (method: string, path: string, body?: object) => fetch(`${base}/api/v1${path}`, {
  method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})

async function showTitle(): Promise<void> {
  await page.mouse.move(0, 0)
  const url = new URL(page.url())
  url.searchParams.set('personTest', String(++navigation))
  url.hash = `/title?key=${encodeURIComponent(current.key)}`
  await page.goto(url.href)
  await expect(actor()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Interstellar', exact: true })).toBeFocused()
}

test.beforeAll(async () => {
  fake = await startFakeTmdb()
  dataDir = mkdtempSync(join(tmpdir(), 'theama-person-data-'))
  userData = mkdtempSync(join(tmpdir(), 'theama-person-profile-'))
  const media = join(dataDir, 'media')
  mkdirSync(media)
  for (const name of ['Interstellar.2014.mkv', 'Dune.2021.mkv']) writeFileSync(join(media, name), 'x')
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none', THEAMA_TMDB_API_BASE: fake.url, THEAMA_TMDB_IMAGE_BASE: fake.imageUrl }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: join(import.meta.dirname, '..'), env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string> })
  page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  base = `http://127.0.0.1:${(JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port: number }).port}`
  token = readFileSync(join(dataDir, 'secrets', 'api-token'), 'utf8').trim()
  expect((await request('PUT', '/metadata/credentials', { tmdbApiKey: GOOD_KEY })).ok).toBe(true)
  expect((await request('POST', '/library/sources', { path: media, libraryType: 'movies' })).ok).toBe(true)
  await expect.poll(async () => {
    const result = await (await request('GET', '/library/titles')).json() as { items: TitleSummary[] }
    current = result.items.find((item) => item.title === 'Interstellar')!
    related = result.items.find((item) => item.title === 'Dune')!
    return result.items.length === 2 && result.items.every((item) => item.matchState === 'matched')
  }).toBe(true)
  await page.route(/\/api\/v1\/library\/title\?/, async (route) => {
    const url = new URL(route.request().url())
    const response = await request('GET', `${url.pathname.replace('/api/v1', '')}${url.search}`)
    const detail = await response.json()
    // Keep library navigation visible alongside the remote filmography fixture.
    if (detail.summary.key === current.key) for (const credit of detail.credits) credit.relatedTitles = [related]
    await route.fulfill({ status: response.status, json: detail })
  })
  await page.route(/\/api\/v1\/metadata\/person\/titles\?/, async (route) => {
    personRequests.push(new URL(route.request().url()))
    if (personHandler) return personHandler(route)
    await route.fulfill({ json: { items } })
  })
  await page.route(/\/api\/v1\/metadata\/search\?/, async (route) => { metadataSearches++; await route.continue() })
  await page.route(/\/api\/v1\/metadata\/suggestions\?/, async (route) => {
    generalSuggestionRequests++
    await route.fulfill({ json: { items: [], hasMore: false } })
  })
  await page.route(/\/api\/v1\/downloads\/releases\?/, async (route) => {
    releaseRequests.push(new URL(route.request().url()))
    await route.fulfill({ json: { source: 'prowlarr', received: 0, items: [] } })
  })
})

test.beforeEach(async () => {
  personRequests = []
  releaseRequests = []
  metadataSearches = 0
  generalSuggestionRequests = 0
  personHandler = null
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 850))
  await showTitle()
})

test.afterAll(async () => {
  await app?.close()
  await fake?.close()
  for (const path of [dataDir, userData]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-person-(data|profile)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
})

test('shows cached cast and director photos with initials for missing or broken images', async ({ browserName: _browserName }, testInfo) => {
  for (const credit of [actor(), director()]) {
    const photo = credit.locator('[data-test="credit-photo"]')
    await photo.scrollIntoViewIfNeeded()
    await expect(photo).toBeVisible()
    await expect(photo).toHaveAttribute('src', /\/api\/v1\/artwork\/thumb-person-\d+\.png/)
    await expect.poll(() => photo.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  }
  const missing = page.locator('[data-test="credit-actor"]').nth(1)
  await expect(missing.locator('[data-test="credit-photo-fallback"]')).not.toBeEmpty()
  await page.screenshot({ path: testInfo.outputPath('cast-portraits.png') })
  await actor().locator('[data-test="credit-photo"]').dispatchEvent('error')
  await expect(actor().locator('[data-test="credit-photo-fallback"]')).toHaveText('MM')
  await expect(actor()).toContainText('Matthew McConaughey')
})

test('loads on click, shows both top sections, scrolls, and retains library navigation', async ({ browserName: _browserName }, testInfo) => {
  expect(personRequests).toHaveLength(0)
  await actor().click()
  await expect(popup().locator('[data-test="credit-top-title"]')).toHaveCount(20)
  await expect(popup()).toContainText('TMDB 8.4/10')
  expect(personRequests[0]!.searchParams.get('category')).toBe('actor')
  expect(releaseRequests).toHaveLength(0)
  expect(await popup().locator('[data-test="credit-content"]').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('person-popup.png') })
  await page.keyboard.press('Escape')
  await expect(popup()).toHaveCount(0)
  await director().click()
  await expect(popup().locator('[data-test="credit-top-title"]')).toHaveCount(20)
  expect(personRequests.at(-1)!.searchParams.get('category')).toBe('director')
  await popup().locator('[data-test="credit-related-title"]').click()
  await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('key')).toBe(related.key)
  await expect(popup()).toHaveCount(0)
})

test('explicit movie and series actions search releases directly without metadata search', async () => {
  for (const kind of ['movie', 'series'] as const) {
    await actor().click()
    const row = popup().locator(`[data-test="credit-top-${kind}"] [data-test="credit-top-title"]`).first()
    await row.locator('[data-test="credit-releases"]').click()
    await expect.poll(() => releaseRequests.length).toBe(kind === 'movie' ? 1 : 2)
    const query = releaseRequests.at(-1)!.searchParams
    expect(query.get('kind')).toBe(kind)
    expect(query.get('title')).toBe(kind === 'movie' ? 'Movie 0' : 'Series 0')
    expect(query.get('year')).toBe(kind === 'movie' ? '2020' : null)
    expect(query.has('season')).toBe(false)
    expect(query.has('episode')).toBe(false)
    expect(metadataSearches).toBe(0)
    expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('personCategory')).toBe('actor')
    await page.locator('[data-test="releases-back"]').click()
    const suggestions = page.locator('[data-test="person-suggestions"]')
    await expect(suggestions.getByRole('heading')).toHaveText('Movies and TV series featuring Matthew McConaughey')
    await expect(suggestions.locator('[data-test="suggestion-item"]')).toHaveCount(10)
    expect(generalSuggestionRequests).toBe(0)
    await showTitle()
  }
})

test('director suggestions retain the person through filtering, previews and release navigation', async () => {
  await director().click()
  await popup().locator('[data-test="credit-top-movie"] [data-test="credit-releases"]').first().click()
  await page.locator('[data-test="releases-back"]').click()
  const suggestions = page.locator('[data-test="person-suggestions"]')
  await expect(suggestions.getByRole('heading')).toHaveText('Movies and TV series directed by Christopher Nolan')
  await page.locator('[data-test="suggestion-filter-all"]').click()
  await expect(suggestions.locator('[data-test="suggestion-item"]')).toHaveCount(20)
  await page.locator('[data-test="find-title"] input').fill('Series 2')
  await page.locator('[data-test="find-search"]').click()
  await expect(suggestions.locator('[data-test="suggestion-item"]')).toHaveCount(1)
  await suggestions.locator('[data-test="suggestion-item"]').click()
  await page.locator('[data-test="suggestion-releases"]').click()
  await expect.poll(() => releaseRequests.length).toBe(2)
  await page.locator('[data-test="releases-back"]').click()
  await expect(suggestions.getByRole('heading')).toHaveText('Movies and TV series directed by Christopher Nolan')
  expect(personRequests.at(-1)!.searchParams.get('category')).toBe('director')
  expect(generalSuggestionRequests).toBe(0)
  expect(metadataSearches).toBe(0)
})

test('failed person suggestions do not fall back to general titles', async () => {
  await actor().click()
  await popup().locator('[data-test="credit-top-movie"] [data-test="credit-releases"]').first().click()
  personHandler = async (route) => { await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Person lookup offline' } } }) }
  await page.locator('[data-test="releases-back"]').click()
  await expect(page.locator('[data-test="person-suggestions-error"]')).toContainText('Person lookup offline')
  expect(generalSuggestionRequests).toBe(0)
  personHandler = null
  await page.locator('[data-test="person-suggestions-retry"]').click()
  await expect(page.locator('[data-test="person-suggestions"] [data-test="suggestion-item"]')).toHaveCount(10)
})

test('reloading a person link preserves its scoped suggestions after connecting', async () => {
  await actor().click()
  await popup().locator('[data-test="credit-top-movie"] [data-test="credit-releases"]').first().click()
  await expect(page.locator('[data-test="releases-back"]')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-test="releases-back"]')).toBeVisible()
  await page.locator('[data-test="releases-back"]').click()
  const suggestions = page.locator('[data-test="person-suggestions"]')
  await expect(suggestions.getByRole('heading')).toHaveText('Movies and TV series featuring Matthew McConaughey')
  await expect(suggestions.locator('[data-test="suggestion-item"]')).toHaveCount(10)
  expect(generalSuggestionRequests).toBe(0)
})

test('errors retain library links, retry succeeds, and empty sections are explained', async () => {
  personHandler = async (route) => { await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Provider offline' } } }) }
  await actor().click()
  await expect(popup().locator('[data-test="credit-error"]')).toContainText('Provider offline')
  await expect(popup().locator('[data-test="credit-related-title"]')).toBeVisible()
  personHandler = async (route) => { await route.fulfill({ json: { items: [] } }) }
  await popup().locator('[data-test="credit-retry"]').click()
  await expect(popup()).toContainText('Top movies')
  await expect(popup()).toContainText('Top TV series')
  await expect(popup().getByText('No titles found for this person in this category.', { exact: true })).toHaveCount(2)
  expect(releaseRequests).toHaveLength(0)
})

test('a dismissed lookup cannot overwrite a different popup and the popup fits a narrow screen', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  personHandler = async (route) => {
    if (new URL(route.request().url()).searchParams.get('category') === 'actor') {
      await pending
      await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Late error' } } }).catch(() => undefined)
    } else await route.fulfill({ json: { items } })
  }
  await actor().click()
  await expect(popup().locator('[data-test="credit-loading"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await director().click()
  await expect(popup().locator('[data-test="credit-top-title"]')).toHaveCount(20)
  finish()
  await expect(popup().locator('[data-test="credit-error"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.setMinimumSize(0, 0)
    win.setContentSize(390, 800)
  })
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(390)
  await director().click()
  await expect(popup()).toBeVisible()
  const bounds = (await popup().boundingBox())!
  expect(bounds.width).toBeLessThanOrEqual(390)
  expect(bounds.height).toBeLessThanOrEqual(560)
  await popup().locator('[data-test="credit-top-series"] [data-test="credit-releases"]').last().scrollIntoViewIfNeeded()
  await expect(popup().locator('[data-test="credit-top-series"] [data-test="credit-releases"]').last()).toBeInViewport()
})
