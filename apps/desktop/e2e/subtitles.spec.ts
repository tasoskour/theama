import { dismissInitialSetup } from './setup-helper'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { startFakeSubtitles, SUBTITLE_TEST_KEY, SUBTITLE_TEST_PASSWORD, type FakeSubtitles } from '../../../tools/fake-subtitles/server'

let app: ElectronApplication
let page: Page
let root: string
let profile: string
let fake: FakeSubtitles
let media: string
let launches: string
test.beforeAll(async () => {
  fake = await startFakeSubtitles()
  root = mkdtempSync(join(tmpdir(), 'theama-subtitles-e2e-'))
  profile = mkdtempSync(join(tmpdir(), 'theama-subtitles-profile-'))
  media = join(root, 'Ταινίες'); mkdirSync(media)
  launches = join(root, 'players.log')
  for (const name of ['Film.2020.mkv', 'Show.S01E01.mkv']) writeFileSync(join(media, name), Buffer.alloc(131072, 1))
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: join(root, 'data'), THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none', THEAMA_TEST_PLAYER_LOG: launches,
    THEAMA_OPENSUBTITLES_API_BASE: fake.openSubtitlesBase, THEAMA_SUBDL_API_BASE: fake.subdlBase, THEAMA_SUBDL_DOWNLOAD_BASE: fake.origin }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: join(import.meta.dirname, '..'), env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string> })
  page = await app.firstWindow()
  await dismissInitialSetup(page)
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  // Add test media through the authenticated API; the provider configuration and downloads below use the UI.
  const runtime = JSON.parse(readFileSync(join(root, 'data', 'runtime.json'), 'utf8')) as { port: number }
  const token = readFileSync(join(root, 'data', 'secrets', 'api-token'), 'utf8').trim()
  // This scenario verifies Greek downloads; choose its language rather than relying on multilingual defaults.
  const prefs = await fetch(`http://127.0.0.1:${runtime.port}/api/v1/settings`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subtitleLanguages: ['el'] }) })
  expect(prefs.status).toBe(200)
  const added = await fetch(`http://127.0.0.1:${runtime.port}/api/v1/library/sources`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: media, libraryType: 'auto' }) })
  expect(added.status).toBe(201)
})
test.afterAll(async () => {
  await app?.close(); await fake?.close()
  for (const path of [root, profile]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-subtitles-(e2e|profile)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true })
  }
})
const navigate = async (hash: string) => { await page.evaluate((path) => { window.location.hash = path }, hash) }

test('configures providers, downloads movie and episode subtitles, and passes Greek subtitles to the player', async () => {
  await navigate('/settings/playback')
  for (const id of ['opensubtitles', 'subdl']) {
    const card = page.locator(`[data-test="subtitle-provider-${id}"]`)
    await card.getByLabel(`${id === 'subdl' ? 'SubDL' : 'OpenSubtitles'} API key`, { exact: true }).fill(SUBTITLE_TEST_KEY)
    await card.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(card.getByText('Configured', { exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.getByText('Connection successful.', { exact: true })).toBeVisible()
  }
  const os = page.locator('[data-test="subtitle-provider-opensubtitles"]')
  await os.getByLabel('OpenSubtitles username').fill('viewer')
  await os.getByLabel('OpenSubtitles password').fill(SUBTITLE_TEST_PASSWORD)
  await os.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(os.getByText('OpenSubtitles account connected.')).toBeVisible()

  await navigate('/movies')
  await page.getByRole('link', { name: 'Film, 2020' }).click()
  await page.getByRole('button', { name: 'Find subtitles' }).click()
  let dialog = page.getByRole('dialog', { name: 'Find subtitles' })
  await expect(dialog.getByText('No subtitles found for this video.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Search subtitles', exact: true }).click()
  await expect(dialog.locator('[data-test="subtitle-result"]')).toHaveCount(2)
  await expect(dialog.locator('[data-test="subtitle-result"]').first()).toContainText('Exact video match')
  await dialog.locator('[data-test="subtitle-result"]').first().getByRole('button', { name: 'Download', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Saved Film.2020.el.srt')
  expect(readFileSync(join(media, 'Film.2020.el.srt'), 'utf8')).toContain('Καλημέρα')
  await page.screenshot({ path: test.info().outputPath('subtitles-dialog.png'), fullPage: true })
  await dialog.locator('[data-test="subtitle-result"]').first().getByRole('button', { name: 'Download', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Your existing file has been preserved.')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('[data-test="subtitle-tracks"]')).toContainText('Film.2020.el.srt')
  await page.locator('.cta__row').getByRole('button', { name: /^Play/ }).first().click()
  await expect.poll(() => existsSync(launches) ? readFileSync(launches, 'utf8') : '').toContain(`Film.2020.el.srt`)

  await navigate('/series')
  await page.getByRole('link', { name: /^Show,/ }).click()
  await page.locator('button.ep__row').first().click()
  await page.getByRole('button', { name: 'Find subtitles' }).click()
  dialog = page.getByRole('dialog', { name: 'Find subtitles' })
  await expect(dialog.getByLabel('Provider', { exact: true })).toBeEnabled()
  await dialog.getByLabel('Provider', { exact: true }).press('ArrowDown')
  await page.getByRole('option', { name: 'SubDL', exact: true }).click()
  await dialog.getByRole('button', { name: 'Search subtitles', exact: true }).click()
  await expect(dialog.locator('[data-test="subtitle-result"]')).toHaveCount(1)
  fake.state.mode = 'multi'
  const downloadsBefore = fake.state.downloads
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Choose a file from this download' })).toBeVisible()
  await dialog.locator('.entries').getByRole('button', { name: 'Download', exact: true }).first().click()
  await expect(dialog.getByRole('status')).toContainText('Saved Show.S01E01.el.srt')
  expect(fake.state.downloads).toBe(downloadsBefore + 1)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('[data-test="subtitle-tracks"]')).toContainText('Show.S01E01.el.srt')
  await page.locator('.ep__actions').getByRole('button', { name: /^Play/ }).click()
  await expect.poll(() => readFileSync(launches, 'utf8')).toContain('Show.S01E01.el.srt')
})
