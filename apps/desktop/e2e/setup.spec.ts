import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../tools/fake-tmdb/server.mjs'
import { startFakeSubtitles, SUBTITLE_TEST_KEY, type FakeSubtitles } from '../../../tools/fake-subtitles/server'
import type { TheamaBridge } from '@theama/contracts'

let app: ElectronApplication
let page: Page
let root: string
let profile: string
let media: string
let tmdb: FakeTmdb
let subtitles: FakeSubtitles
let clientServer: Server
let clientUrl: string
let clientDown = false
const errors: string[] = []
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'theama-setup-data-'))
  profile = mkdtempSync(join(tmpdir(), 'theama-setup-profile-'))
  media = mkdtempSync(join(tmpdir(), 'theama-setup-media-'))
  writeFileSync(join(media, 'Interstellar (2014).mkv'), 'test video')
  tmdb = await startFakeTmdb()
  subtitles = await startFakeSubtitles()
  clientServer = createServer(async (req, res) => {
    if (clientDown) { res.writeHead(503).end(); return }
    if (req.url === '/api/v2/auth/login') {
      let body = ''
      for await (const chunk of req) body += String(chunk)
      const form = new URLSearchParams(body)
      if (form.get('username') === 'viewer' && form.get('password') === 'wizard-password') res.writeHead(200, { 'Set-Cookie': 'SID=setup-test; path=/' }).end('Ok.')
      else res.end('Fails.')
      return
    }
    if (req.url === '/api/v1/system/status') {
      if (req.headers['x-api-key'] !== 'prowlarr-test-key') res.writeHead(401).end()
      else res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ version: '1.0.0' }))
      return
    }
    if (req.headers.cookie !== 'SID=setup-test') { res.writeHead(403).end(); return }
    if (req.url === '/api/v2/app/version') res.end('v5.0.1')
    else if (req.url === '/api/v2/app/webapiVersion') res.end('2.11.2')
    else if (req.url?.startsWith('/api/v2/torrents/info')) res.writeHead(200, { 'Content-Type': 'application/json' }).end('[]')
    else res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => clientServer.listen(0, '127.0.0.1', resolve))
  clientUrl = `http://127.0.0.1:${(clientServer.address() as { port: number }).port}`
  const env: NodeJS.ProcessEnv = {
    ...process.env, THEAMA_DATA_DIR: root, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none',
    THEAMA_TMDB_API_BASE: tmdb.url, THEAMA_TMDB_IMAGE_BASE: tmdb.imageUrl,
    THEAMA_OPENSUBTITLES_API_BASE: subtitles.openSubtitlesBase, THEAMA_SUBDL_API_BASE: subtitles.subdlBase,
    THEAMA_TEST_PICK_FOLDER: media, THEAMA_TEST_PLAYER_LOG: join(root, 'player.log'),
  }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: join(import.meta.dirname, '..'), env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string> })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // Avoid external VPN checks and real app launches during tests.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('downloadTools:status')
    ipcMain.handle('downloadTools:status', () => ({ vpn: { state: 'unknown', reason: 'check_failed', checkedAt: Date.now(), location: null }, tools: { nordvpn: { installed: false, running: false }, qbittorrent: { installed: false, running: false }, prowlarr: { installed: false, running: false } } }))
  })
})

test.afterAll(async () => {
  await app?.close()
  await tmdb?.close()
  await subtitles?.close()
  if (clientServer) await new Promise<void>((resolve) => clientServer.close(() => resolve()))
  for (const path of [root, profile, media]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-setup-(data|profile|media)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true })
  }
})

async function navigate(path: string): Promise<void> {
  await page.evaluate(hash => { window.location.hash = hash }, path)
}
const next = () => page.locator('[data-test="setup-next"]').click()
const skipped = () => page.locator('[data-test="setup-skip"]').click()
const stepHeading = (name: string) => expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()

test('fresh profile opens once, permits skip and finish later, then resumes at its saved step', async () => {
  await stepHeading('Welcome and language')
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  await next()
  await stepHeading('Backend and service')
  await skipped()
  await stepHeading('Media folders')
  await page.locator('[data-test="setup-later"]').click()
  await expect(page).toHaveURL(/#\/$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Welcome to Theama' })).toBeVisible()
  await expect(page.locator('[data-test="setup-wizard"]')).toHaveCount(0)
  await navigate('/settings/setup')
  await page.locator('[data-test="setup-launch"]').click()
  await stepHeading('Media folders')
})

test('shared forms add folders and player, reject invalid credentials, and save valid credentials before advancing', async () => {
  await page.getByRole('button', { name: 'Add folder', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Add folder', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.setup-form')).toContainText(media)
  await next()
  await stepHeading('Video player')
  await page.getByRole('radio', { name: 'VLC media player', exact: true }).check()
  await next()
  await stepHeading('TMDB metadata')
  await page.locator('[data-test="tmdb-key"] input').fill('invalid-key-123456789')
  await next()
  await expect(page.locator('[data-test="setup-save-error"]')).toBeVisible()
  await stepHeading('TMDB metadata')
  await page.locator('[data-test="tmdb-key"] input').fill(GOOD_KEY)
  await next()
  await stepHeading('Subtitles')
  await page.locator('[data-test="subtitle-provider-opensubtitles"] input[type="password"]').first().fill('invalid-subtitle-key')
  await next()
  await expect(page.locator('[data-test="setup-save-error"]')).toBeVisible()
  for (const id of ['opensubtitles', 'subdl']) await page.locator(`[data-test="subtitle-provider-${id}"] input[type="password"]`).first().fill(SUBTITLE_TEST_KEY)
  await next()
  await stepHeading('Downloads and search')
  await page.locator('[data-test="qb-url"] input').fill(clientUrl)
  await page.locator('[data-test="qb-user"] input').fill('viewer')
  await page.locator('[data-test="qb-pass"] input').fill('wrong-password')
  await next()
  await expect(page.locator('[data-test="setup-save-error"]')).toBeVisible()
  await page.locator('[data-test="qb-pass"] input').fill('wizard-password')
  await page.locator('[data-test="prowlarr-url"] input').fill(clientUrl)
  await page.locator('[data-test="prowlarr-key"] input').fill('wrong-prowlarr-key')
  await next()
  await expect(page.locator('[data-test="setup-save-error"]')).toBeVisible()
  await page.locator('[data-test="prowlarr-key"] input').fill('prowlarr-test-key')
  await next()
  await stepHeading('Final review')
  await expect(page.locator('[data-test="setup-review"] [data-status="configured"]')).toHaveCount(7)
  await next()
  await expect(page.locator('[data-test="setup-wizard"]')).toHaveCount(0)
  const stored = await page.evaluate(() => localStorage.getItem('theama.setup.v1')!)
  for (const secret of [GOOD_KEY, SUBTITLE_TEST_KEY, 'wizard-password', 'prowlarr-test-key']) expect(stored).not.toContain(secret)
  expect(JSON.parse(stored).state).toBe('completed')
})

test('guide search, clear, contextual topics and safe official resource links work', async () => {
  await navigate('/settings/setup')
  const search = page.getByRole('textbox', { name: 'Search setup instructions', exact: true })
  await search.fill('unfindable-setup-phrase')
  await expect(page.getByText('No instructions match your search.')).toBeVisible()
  await search.fill('API Read Access Token')
  await expect(page.getByRole('heading', { name: 'TMDB: posters, identification and descriptions', exact: true })).toBeVisible()
  await search.fill('')
  const resource = page.getByRole('link', { name: 'Official API registration instructions', exact: false })
  await expect(resource).toHaveAttribute('href', 'https://developer.themoviedb.org/docs/getting-started')
  await app.evaluate(({ ipcMain }) => {
    Object.assign(globalThis, { setupOpened: null })
    ipcMain.removeHandler('shell:openExternal')
    ipcMain.handle('shell:openExternal', (_event, request: unknown) => { Object.assign(globalThis, { setupOpened: request }) })
  })
  await resource.click()
  expect(await app.evaluate(() => (globalThis as unknown as { setupOpened: unknown }).setupOpened)).toEqual({ service: 'setup', resource: 'tmdbDocs' })
  await navigate('/settings/metadata')
  await page.getByRole('link', { name: 'Setup instructions and download links' }).click()
  await expect(page).toHaveURL(/topic=metadata/)
  await expect(page.locator('#guide-metadata')).toBeFocused()
  await expect(page.locator('#guide-metadata')).toBeInViewport()
})

test('configured but unavailable download clients need attention and saved subtitle keys alone are unverified after reload', async () => {
  clientDown = true
  await navigate('/settings/setup')
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(page.locator('article').filter({ has: page.locator('#guide-downloads') }).locator('[data-status="attention"]')).toBeVisible()
  clientDown = false
  await page.reload()
  await expect(page.locator('article').filter({ has: page.locator('#guide-subtitles') }).locator('[data-status="unavailable"]')).toBeVisible()
})

test('guide and service setup stay accessible when the backend is stopped', async () => {
  await page.evaluate(() => (window as unknown as { theama: TheamaBridge }).theama.service.stop())
  try {
    await navigate('/settings/setup?topic=service')
    await expect(page.locator('[data-test="setup-guide"]')).toBeVisible()
    await expect(page.locator('#guide-service')).toBeVisible()
    await expect(page.locator('article').filter({ has: page.locator('#guide-metadata') }).locator('[data-status="unavailable"]')).toBeVisible()
    await page.getByRole('button', { name: 'Restart wizard' }).click()
    await next()
    await stepHeading('Backend and service')
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
    await skipped()
    await stepHeading('Media folders')
    await expect(page.locator('[data-test="setup-next"]')).toBeDisabled()
    await expect(page.locator('[data-test="setup-skip"]')).toBeEnabled()
  } finally {
    await page.evaluate(() => (window as unknown as { theama: TheamaBridge }).theama.service.start())
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  }
})

test('service account selection can be cancelled and an elevation cancellation leaves the wizard usable', async () => {
  await navigate('/settings/setup')
  await page.getByRole('button', { name: 'Restart wizard' }).click()
  await next()
  await stepHeading('Backend and service')
  await expect(page.locator('[data-test="setup-next"]')).toBeEnabled()
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const status = { host: 'nssm', state: 'not-installed', serviceName: 'Theama', apiReachable: false, pid: null, account: null, detail: null }
    Object.assign(globalThis, { setupInstalls: 0 })
    ipcMain.removeHandler('service:install')
    ipcMain.handle('service:install', () => {
      const state = globalThis as unknown as { setupInstalls: number }
      state.setupInstalls++
      return { ok: false, message: 'The elevation request was cancelled.', status }
    })
    BrowserWindow.getAllWindows()[0]!.webContents.send('ev:service-status', status)
  })
  await page.getByRole('button', { name: 'Install…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await app.evaluate(() => (globalThis as unknown as { setupInstalls: number }).setupInstalls)).toBe(0)
  await page.getByRole('button', { name: 'Install…', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('The elevation request was cancelled.', { exact: false })).toBeVisible()
  await skipped()
  await stepHeading('Media folders')
})

test('skip-all completes without changing saved configuration and existing profiles keep normal startup', async () => {
  await navigate('/settings/setup')
  await page.getByRole('button', { name: 'Restart wizard' }).click()
  await next()
  for (let i = 0; i < 6; i++) await skipped()
  await stepHeading('Final review')
  await next()
  await expect(page).toHaveURL(/#\/$/)
  await page.reload()
  await expect(page.locator('[data-test="setup-wizard"]')).toHaveCount(0)
  expect(readFileSync(join(root, 'secrets', 'tmdb.key'), 'utf8')).toContain(GOOD_KEY)
  // A cached profile from before onboarding existed must also keep its normal startup.
  await page.evaluate(() => { localStorage.removeItem('theama.setup.v1') })
  await page.reload()
  await expect(page.locator('[data-test="setup-wizard"]')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
})

test('English and Greek guide and wizard work in both themes, large text and narrow windows', async () => {
  const port = (JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')) as { port: number }).port
  const token = readFileSync(join(root, 'secrets', 'api-token'), 'utf8').trim()
  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8')
  for (const language of ['en', 'el'] as const) for (const theme of ['dark', 'light'] as const) {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/settings`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ language, theme, textSize: 'extra-large' }) })
    expect(response.ok).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(560, 850))
    await navigate('/settings/setup')
    await expect(page.getByRole('heading', { name: language === 'el' ? 'Οδηγός ρύθμισης' : 'Setup Guide', exact: true })).toBeVisible()
    await page.evaluate(axeSource)
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run(context: Document, options: object): Promise<{ violations: { id: string }[] }> } }).axe
      return (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { 'color-contrast': { enabled: false } } })).violations.map((v) => v.id)
    })
    expect(violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.locator('[data-test="setup-launch"]').click()
    await expect(page.locator('[data-test="setup-wizard"]')).toBeVisible()
    await page.evaluate(axeSource)
    const wizardViolations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run(context: Document, options: object): Promise<{ violations: { id: string }[] }> } }).axe
      return (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { 'color-contrast': { enabled: false } } })).violations.map((v) => v.id)
    })
    expect(wizardViolations).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`setup-${language}-${theme}.png`) })
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true)
    await page.locator('[data-test="setup-later"]').click()
  }
  expect(errors).toEqual([])
})
