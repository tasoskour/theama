import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../tools/fake-tmdb/server.mjs'
import { dismissInitialSetup } from './setup-helper'

let app: ElectronApplication
let page: Page
let fake: FakeTmdb
let dataDir: string
let profile: string
let base: string
let token: string
const errors: string[] = []

const api = (path: string, method = 'GET', body?: object): Promise<Response> =>
  fetch(`${base}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

async function visit(route: string): Promise<void> {
  await page.goto(`${page.url().split('#')[0]}#${route}`)
  await page.getByRole('button', { name: 'Browse', exact: true }).click()
  await expect(page.locator('[data-test="title-shelves"]')).toBeVisible()
}

test.beforeAll(async () => {
  fake = await startFakeTmdb()
  dataDir = mkdtempSync(join(tmpdir(), 'theama-shelves-data-'))
  profile = mkdtempSync(join(tmpdir(), 'theama-shelves-profile-'))
  const media = join(dataDir, 'media')
  mkdirSync(media)
  for (const file of ['Interstellar.2014.mkv', 'Parasite.2019.mkv', 'Severance.S01E01.mkv', 'Severance.S01E02.mkv', 'Zxqv.Wplm.2003.mkv']) {
    writeFileSync(join(media, file), 'x')
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  Object.assign(env, { THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none', THEAMA_TMDB_API_BASE: fake.url, THEAMA_TMDB_IMAGE_BASE: fake.imageUrl })
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: join(import.meta.dirname, '..'), env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await dismissInitialSetup(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 90_000 })
  const { port } = JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port: number }
  base = `http://127.0.0.1:${port}`
  token = readFileSync(join(dataDir, 'secrets', 'api-token'), 'utf8').trim()
  expect((await api('/library/sources', 'POST', { path: media, libraryType: 'auto' })).ok).toBe(true)
  expect((await api('/metadata/credentials', 'PUT', { tmdbApiKey: GOOD_KEY })).ok).toBe(true)
  await expect.poll(async () => {
    const status = await (await api('/metadata/status')).json() as { matched: number; pending: number; state: string }
    return status.matched === 3 && status.pending === 0 && status.state === 'idle'
  }, { timeout: 60_000 }).toBe(true)
  const { items } = await (await api('/library/titles')).json() as { items: { key: string; title: string }[] }
  for (const title of ['Interstellar', 'Severance']) {
    const key = items.find(item => item.title === title)!.key
    const detail = await (await api(`/library/title?key=${encodeURIComponent(key)}`)).json() as { files: { id: number }[] }
    expect((await api(`/playback/files/${detail.files[0]!.id}/progress`, 'PUT', { positionSeconds: 600, durationSeconds: 3600 })).ok).toBe(true)
  }
})

test.afterAll(async () => {
  await app?.close()
  await fake?.close()
  for (const path of [dataDir, profile]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-shelves-(data|profile)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
})

test('movies and series follow Home shelf order with kind-specific genres and counts', async () => {
  for (const [route, title, other, count] of [['movies', 'Interstellar', 'Severance', 2], ['series', 'Severance', 'Interstellar', 1]] as const) {
    await visit(`/${route}`)
    const resume = page.locator('[data-test="continue-rail"]')
    await expect(resume.getByRole('link', { name: new RegExp(`^${title},`) })).toBeVisible()
    await expect(resume.getByText(/10:00/)).toBeVisible()
    await expect(page.locator('[data-test="title-shelves"]').getByRole('link', { name: new RegExp(`^${other},`) })).toHaveCount(0)
    await expect.poll(() => page.locator('[data-rail] h2').allTextContents()).toEqual(expect.arrayContaining(['Continue watching', 'Recently added', 'Drama']))
    const headings = await page.locator('[data-rail] h2').allTextContents()
    expect(headings.slice(0, 2)).toEqual(['Continue watching', 'Recently added'])
    expect(headings.indexOf('Drama')).toBeGreaterThan(1)
    await page.locator('.genre-filter__select .v-field').click()
    const drama = page.getByRole('option', { name: `Drama ${count}`, exact: true })
    await expect(drama).toContainText(String(count))
    await drama.click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-test="title-shelves"]')).toHaveCount(0)
    await expect(page.locator('.genre-filter__chip')).toContainText('Drama')
    await expect(page.locator('.count')).toHaveText(`${count} ${count === 1 ? 'title' : 'titles'}`)
    await expect(page.locator('.grid [data-title-key]')).toHaveCount(count)
  }
})

test('See all opens the complete list, preserves the view on return, and Browse restores shelves', async () => {
  await visit('/movies')
  const recent = page.getByRole('region', { name: 'Recently added', exact: true })
  await recent.getByRole('button', { name: 'See all (3)' }).click()
  await expect(page.locator('[data-test="title-shelves"]')).toHaveCount(0)
  await expect(page.locator('.grid [data-title-key]')).toHaveCount(3)
  await page.getByRole('link', { name: /^Zxqv Wplm,/ }).click()
  await expect(page.getByRole('heading', { name: 'Zxqv Wplm', level: 1 })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.grid [data-title-key]')).toHaveCount(3)
  await expect(page.getByRole('link', { name: /^Zxqv Wplm,/ })).toBeFocused()
  await page.getByRole('button', { name: 'Browse', exact: true }).click()
  await expect(page.locator('[data-test="title-shelves"]')).toBeVisible()
  const drama = page.getByRole('region', { name: 'Drama', exact: true })
  await drama.getByRole('button', { name: 'See all (2)' }).click()
  await expect(page.locator('.grid [data-title-key]')).toHaveCount(2)
  await expect(page.locator('.genre-filter__chip')).toContainText('Drama')
})

test('shelves and filters fit a narrow viewport', async () => {
  await visit('/movies')
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
    await expect(page.locator('[data-test="title-shelves"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.locator('.genre-filter__select .v-field').click()
    await expect(page.getByRole('option', { name: 'Drama 2', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  } finally {
    await cdp.detach()
  }
})
