import { dismissInitialSetup } from './setup-helper'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type Route } from '@playwright/test'
import type { CollectionDetail, CollectionSummary, TitleDetail, TitleSummary } from '@theama/contracts'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../tools/fake-tmdb/server.mjs'

let app: ElectronApplication
let page: Page
let fake: FakeTmdb
let dataDir: string
let userData: string
let base: string
let token: string
let seriesKey: string
let officialId: number
let userId: number
let providerConfigured = true
let extraGaps = false
let releaseFailure = false
let releaseRequests: URL[] = []
let metadataSearches = 0
let releaseHandler: ((route: Route) => Promise<void>) | null = null
const emptyReleases = { source: 'prowlarr', received: 0, items: [] }
const request = (method: string, path: string, body?: object) => fetch(`${base}/api/v1${path}`, {
  method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})
const show = (path: string) => page.goto(`${page.url().split('#')[0]}#${path}`)
const releaseParams = () => Object.fromEntries(releaseRequests.at(-1)!.searchParams)

test.beforeAll(async () => {
  fake = await startFakeTmdb()
  dataDir = mkdtempSync(join(tmpdir(), 'theama-missing-data-'))
  userData = mkdtempSync(join(tmpdir(), 'theama-missing-profile-'))
  for (const [folder, files] of [
    ['media', ['Mad.Max.1979.mkv', 'Mad.Max.Fury.Road.2015.mkv', 'Severance.S01E01.mkv', 'Severance.S01E03.mkv']],
    ['absent', ['Interstellar.2014.mkv', 'Dark.S01E01.mkv']],
    ['personal', ['Trip to Crete.mp4']],
  ] as const) {
    mkdirSync(join(dataDir, folder))
    for (const file of files) writeFileSync(join(dataDir, folder, file), 'x')
  }
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none', THEAMA_TMDB_API_BASE: fake.url, THEAMA_TMDB_IMAGE_BASE: fake.imageUrl }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: join(import.meta.dirname, '..'), env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string> })
  page = await app.firstWindow()
  await dismissInitialSetup(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  base = `http://127.0.0.1:${(JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port: number }).port}`
  token = readFileSync(join(dataDir, 'secrets', 'api-token'), 'utf8').trim()
  expect((await request('PUT', '/metadata/credentials', { tmdbApiKey: GOOD_KEY })).ok).toBe(true)
  const removedSources: number[] = []
  for (const folder of ['media', 'absent', 'personal']) {
    const response = await request('POST', '/library/sources', { path: join(dataDir, folder), libraryType: folder === 'personal' ? 'videos' : 'auto' })
    expect(response.ok).toBe(true)
    if (folder !== 'media') removedSources.push((await response.json() as { id: number }).id)
  }
  let titles: TitleSummary[] = []
  await expect.poll(async () => {
    titles = (await (await request('GET', '/library/titles')).json() as { items: TitleSummary[] }).items
    return titles.length === 6 && titles.every((title) => title.kind === 'video' || title.matchState === 'matched')
  }).toBe(true)
  seriesKey = titles.find((title) => title.title === 'Severance')!.key
  const collection = await request('POST', '/collections', { name: 'Missing picks' })
  expect(collection.ok).toBe(true)
  userId = (await collection.json() as CollectionDetail).summary.id
  for (const title of titles.filter((title) => ['Interstellar', 'Dark', 'Trip to Crete', 'Mad Max'].includes(title.title))) {
    expect((await request('POST', `/collections/${userId}/members`, { key: title.key })).ok).toBe(true)
  }
  for (const id of removedSources) expect((await request('DELETE', `/library/sources/${id}`)).ok).toBe(true)
  await expect.poll(async () => {
    const list = await (await request('GET', '/collections?kind=official')).json() as { items: CollectionSummary[] }
    officialId = list.items.find((item) => item.name === 'Mad Max Collection')?.id ?? 0
    return officialId > 0
  }).toBe(true)

  // Providers are local fixtures: these tests never contact an indexer or start a download.
  await page.route(/\/api\/v1\/downloads\/status$/, async (route) => route.fulfill({ json: { state: 'not_configured', url: null, username: null, version: null, webApiVersion: null, message: null } }))
  await page.route(/\/api\/v1\/downloads\/indexer$/, async (route) => route.fulfill({ json: { state: providerConfigured ? 'unreachable' : 'not_configured', url: providerConfigured ? 'http://127.0.0.1:1' : null, version: null, message: null } }))
  await page.route(/\/api\/v1\/downloads\/releases\?/, async (route) => {
    releaseRequests.push(new URL(route.request().url()))
    if (releaseHandler) return releaseHandler(route)
    if (releaseFailure) await route.fulfill({ status: 503, json: { error: { code: 'unreachable', message: 'Indexer is unavailable.' } } })
    else await route.fulfill({ json: emptyReleases })
  })
  await page.route(/\/api\/v1\/metadata\/search\?/, async (route) => { metadataSearches++; await route.continue() })
  await page.route(/\/api\/v1\/library\/title\?/, async (route) => {
    const url = new URL(route.request().url())
    const response = await request('GET', `/library/title${url.search}`)
    const detail = await response.json() as TitleDetail
    if (extraGaps && detail.summary.key === seriesKey) {
      detail.episodes.push({ ...detail.episodes[0]!, season: 0, episode: 0, name: 'Missing special', airDate: '2020-01-01', status: 'missing', fileIds: [] })
      detail.episodes.push({ ...detail.episodes[0]!, season: 2, episode: 3, name: 'Undated episode', airDate: null, status: 'undated', fileIds: [] })
      detail.coverage!.seasons.push({ season: 0, expected: 1, local: 0, missing: 1, upcoming: 0, undated: 0, notInProvider: 0, duplicates: 0 })
    }
    await route.fulfill({ status: response.status, json: detail })
  })
})

test.beforeEach(async () => {
  providerConfigured = true
  extraGaps = false
  releaseFailure = false
  releaseHandler = null
  releaseRequests = []
  metadataSearches = 0
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    win.setMinimumSize(0, 0)
    win.setContentSize(1100, 850)
  })
  expect((await request('PUT', '/settings', { language: 'en', theme: 'dark' })).ok).toBe(true)
  await show(`/collection?id=${officialId}`)
  await page.reload()
  await expect(page.locator('[data-test="collection-find-releases"]')).toHaveCount(2)
})

test.afterAll(async () => {
  await app?.close()
  await fake?.close()
  for (const path of [dataDir, userData]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-missing-(data|profile)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
})

test('searches a missing official movie by keyboard without making its poster playable', async () => {
  const ghost = page.locator('[data-test="contextual-member"]').filter({ hasText: 'Mad Max 2' })
  await expect(ghost.locator('a, button')).toHaveCount(0)
  const link = page.getByRole('link', { name: 'Find releases for Mad Max 2', exact: true })
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-test="release-year"] input')).toHaveValue('1981')
  await expect.poll(() => releaseRequests.length).toBe(1)
  expect(releaseParams()).toMatchObject({ kind: 'movie', title: 'Mad Max 2', year: '1981' })
  expect(metadataSearches).toBe(0)
})

test('searches absent user collection movies and series, leaving personal and local items alone', async () => {
  await show(`/collection?id=${userId}`)
  await expect(page.locator('[data-test="contextual-member"]')).toHaveCount(3)
  await expect(page.locator('[data-test="collection-find-releases"]')).toHaveCount(2)
  await page.getByRole('link', { name: 'Find releases for Interstellar', exact: true }).click()
  await expect.poll(() => releaseRequests.length).toBe(1)
  expect(releaseParams()).toMatchObject({ kind: 'movie', title: 'Interstellar', year: '2014' })
  await page.goBack()
  await page.getByRole('link', { name: 'Find releases for Dark', exact: true }).click()
  await expect.poll(() => releaseRequests.length).toBe(2)
  expect(releaseParams()).toMatchObject({ kind: 'series', title: 'Dark' })
  expect(releaseParams()).not.toHaveProperty('year')
  expect(releaseParams()).not.toHaveProperty('season')
})

test('searches individual gaps and complete seasons, including a season with no local episodes', async () => {
  extraGaps = true
  await show(`/title?key=${encodeURIComponent(seriesKey)}`)
  const gap = page.locator('li[data-gap="missing"]').filter({ hasText: 'Half Loop' })
  await expect(gap.locator('[data-test="play-episode"], button')).toHaveCount(0)
  await gap.getByRole('link', { name: 'Find episode S01E02 of Severance' }).click()
  await expect.poll(() => releaseRequests.length).toBe(1)
  expect(releaseParams()).toMatchObject({ kind: 'series', title: 'Severance', season: '1', episode: '2' })
  await page.goBack()
  await page.locator('[data-test="find-season-releases"]').click()
  await expect.poll(() => releaseRequests.length).toBe(2)
  expect(releaseParams()).toMatchObject({ kind: 'series', season: '1' })
  expect(releaseParams()).not.toHaveProperty('episode')
  await page.goBack()
  await page.getByRole('tab', { name: /Season 2/ }).click()
  await expect(page.locator('li[data-gap="upcoming"] a, li[data-gap="undated"] a')).toHaveCount(0)
  await page.locator('[data-test="find-season-releases"]').click()
  await expect.poll(() => releaseRequests.length).toBe(3)
  expect(releaseParams()).toMatchObject({ kind: 'series', season: '2' })
  expect(releaseParams()).not.toHaveProperty('episode')
  await expect(page.locator('[data-test="release-episode"] input')).toHaveValue('')
})

test('refreshes mounted release searches and drops stale requests and episode context', async () => {
  let finish!: () => void
  releaseHandler = async (route) => {
    if (new URL(route.request().url()).searchParams.get('title') === 'Slow show') await new Promise<void>((resolve) => { finish = resolve })
    await route.fulfill({ json: emptyReleases }).catch(() => undefined) // an obsolete request may already have been aborted
  }
  await show('/downloads?releases=1&kind=series&title=Slow+show&season=1&episode=2')
  await expect.poll(() => releaseRequests.length).toBe(1)
  await page.locator('[data-test="tab-active"]').click()
  try {
    await show('/downloads?releases=1&kind=series&title=Severance&season=2')
    await expect.poll(() => releaseRequests.length).toBe(2)
    await expect(page.locator('[data-test="tab-find"]')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-test="release-season"] input')).toHaveValue('2')
    await expect(page.locator('[data-test="release-episode"] input')).toHaveValue('')
  } finally { finish() }
  await show('/downloads?releases=1&kind=movie&title=Mad+Max&year=1979')
  await expect.poll(() => releaseRequests.length).toBe(3)
  expect(releaseParams()).toMatchObject({ kind: 'movie', year: '1979' })
  expect(releaseParams()).not.toHaveProperty('season')
  await show('/downloads')
  await expect(page.locator('[data-test="find-title"] input')).toHaveValue('')
  await expect(page.locator('[data-test="release-search"]')).toHaveCount(0)
})

test('validates route numbers and accepts specials season zero', async () => {
  await show('/downloads?releases=1&kind=series&title=Severance&season=0&episode=0')
  await expect.poll(() => releaseRequests.length).toBe(1)
  expect(releaseParams()).toMatchObject({ season: '0', episode: '0' })
  await show('/downloads?releases=1&kind=series&title=Severance&season=1oops&episode=2')
  await expect.poll(() => releaseRequests.length).toBe(2)
  expect(releaseParams()).not.toHaveProperty('season')
  expect(releaseParams()).not.toHaveProperty('episode')
  await show('/downloads?releases=1&kind=series&title=Severance&season=1&episode=1000')
  await expect.poll(() => releaseRequests.length).toBe(3)
  expect(releaseParams()).toMatchObject({ season: '1' })
  expect(releaseParams()).not.toHaveProperty('episode')
})

test('hides shortcuts without providers and shows search failures for configured providers', async () => {
  providerConfigured = false
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Mad Max Collection' })).toBeVisible()
  await expect(page.locator('[data-test="collection-find-releases"]')).toHaveCount(0)
  await show(`/title?key=${encodeURIComponent(seriesKey)}`)
  await expect(page.locator('li[data-gap="missing"]')).toHaveCount(1)
  await expect(page.locator('[data-test="find-episode-releases"], [data-test="find-season-releases"]')).toHaveCount(0)
  providerConfigured = true
  releaseFailure = true
  await page.reload()
  await page.locator('[data-test="find-episode-releases"]').click()
  await expect(page.locator('[data-test="release-error"]')).toContainText('Indexer is unavailable.')
})

test('keeps the original title download shortcut and localized missing searches usable on narrow screens', async ({ browserName: _browserName }, testInfo) => {
  await show(`/title?key=${encodeURIComponent(seriesKey)}`)
  await page.locator('[data-test="find-download"]').click()
  await expect(page.locator('[data-test="match-list"]')).toBeVisible()
  expect(metadataSearches).toBe(1)
  expect(releaseRequests).toHaveLength(0)
  expect((await request('PUT', '/settings', { language: 'el', theme: 'light' })).ok).toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(380, 850))
  await show(`/title?key=${encodeURIComponent(seriesKey)}`)
  const episode = page.locator('[data-test="find-episode-releases"]')
  await expect(episode).toHaveText('Εύρεση επεισοδίου')
  await episode.scrollIntoViewIfNeeded()
  await expect(episode).toBeInViewport()
  expect(await episode.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('missing-episode-greek-mobile.png') })
  await show(`/collection?id=${officialId}`)
  const movie = page.locator('[data-test="collection-find-releases"]').first()
  await expect(movie).toHaveText('Εύρεση εκδόσεων')
  await movie.scrollIntoViewIfNeeded()
  await expect(movie).toBeInViewport()
  expect(await movie.evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true)
})
