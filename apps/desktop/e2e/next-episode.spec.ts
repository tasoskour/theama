import { dismissInitialSetup } from './setup-helper'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page
let root: string
let profile: string
let playerPort: number | undefined
let playerLog: string
let apiBase: string
let token: string
const api = (method: string, path: string, body?: unknown) => fetch(`${apiBase}${path}`, {
  method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const launches = () => readFileSync(playerLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { args: string[] })
const current = async () => {
  const res = await fetch(`http://127.0.0.1:${playerPort}/test/current`)
  return await res.json() as { file: string; pid: number }
}
async function notice(): Promise<Page> {
  let window: Page | undefined
  await expect.poll(() => { window = app.windows().find((p) => p.url().includes('/next-episode-notification')); return !!window }, { timeout: 20_000 }).toBe(true)
  return window!
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'theama-next-e2e-'))
  profile = mkdtempSync(join(tmpdir(), 'theama-next-profile-'))
  const media = join(root, 'Σειρές')
  mkdirSync(media)
  for (const name of ['Show.S01E01.mkv', 'Show.S01E02.mkv', 'Show.S01E03.mkv']) writeFileSync(join(media, name), 'fixture')
  playerLog = join(root, 'players.log')
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: join(root, 'data'), THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none',
    THEAMA_TEST_PLAYER_LOG: playerLog, THEAMA_TEST_PLAYER_SCRIPT: join(import.meta.dirname, 'fixtures', 'tracked-vlc.mjs'), THEAMA_TEST_PLAYER_NODE: process.execPath }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: join(import.meta.dirname, '..'),
    env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string> })
  page = await app.firstWindow()
  await dismissInitialSetup(page)
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  const runtime = JSON.parse(readFileSync(join(root, 'data', 'runtime.json'), 'utf8')) as { port: number }
  apiBase = `http://127.0.0.1:${runtime.port}/api/v1`
  token = readFileSync(join(root, 'data', 'secrets', 'api-token'), 'utf8').trim()
  expect((await api('POST', '/library/sources', { path: media, libraryType: 'auto' })).status).toBe(201)
  expect((await api('PUT', '/settings', { nextEpisodeCountdownSeconds: 2 })).status).toBe(200)
})

test.afterAll(async () => {
  if (playerPort) await fetch(`http://127.0.0.1:${playerPort}/test/quit`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined)
  await app?.close()
  for (const path of [root, profile]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-next-(e2e|profile)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true })
  }
})

test('advances on EOF twice through the real tracker, backend, countdown and player controls without closing VLC', async () => {
  await page.evaluate(() => { window.location.hash = '/series' })
  await page.getByRole('link', { name: /^Show,/ }).click()
  await page.locator('[data-test="play"]').click()
  await expect.poll(() => existsSync(playerLog)).toBe(true)
  playerPort = Number(launches()[0]!.args.find((arg) => arg.startsWith('--http-port='))!.split('=')[1])
  await expect.poll(async () => (await current().catch(() => ({ file: '' }))).file).toContain('S01E01')
  const originalPid = (await current()).pid
  await app.evaluate(async ({ BrowserWindow }) => {
    const player = new BrowserWindow({ title: 'Test fullscreen player', fullscreen: true, alwaysOnTop: true })
    await player.loadURL('data:text/html,<title>Test fullscreen player</title><body style="background:black">Fullscreen player</body>')
    player.focus()
  })
  await fetch(`http://127.0.0.1:${playerPort}/test/finish`)
  const firstNotice = await notice()
  await expect(firstNotice.locator('#title')).toContainText('S01E02')
  await expect(firstNotice.locator('[data-test="next-up-count"]')).toContainText('The next episode starts')
  await firstNotice.screenshot({ path: test.info().outputPath('next-episode-notification.png') })
  const state = await app.evaluate(({ BrowserWindow, screen }) => {
    const notification = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/next-episode-notification'))!
    const player = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Test fullscreen player')!
    const bounds = notification.getBounds()
    const display = screen.getDisplayMatching(bounds)
    return { focused: player.isFocused(), overlayFocused: notification.isFocused(), top: notification.isAlwaysOnTop(), silent: notification.webContents.isAudioMuted(),
      left: bounds.x - display.bounds.x, bottom: display.bounds.y + display.bounds.height - bounds.y - bounds.height }
  })
  expect(state).toMatchObject({ focused: true, overlayFocused: false, top: true, silent: true, left: 12 })
  expect(state.bottom).toBeGreaterThanOrEqual(12)
  await expect.poll(async () => (await current()).file).toContain('S01E02')
  expect((await current()).pid).toBe(originalPid)
  await expect.poll(() => firstNotice.isClosed()).toBe(true)
  await fetch(`http://127.0.0.1:${playerPort}/test/finish`)
  const secondNotice = await notice()
  await expect(secondNotice.locator('#title')).toContainText('S01E03')
  await secondNotice.locator('[data-test="next-up-play"]').click()
  await expect.poll(async () => (await current()).file).toContain('S01E03')
  await expect.poll(() => secondNotice.isClosed()).toBe(true)
  expect((await current()).pid).toBe(originalPid)
  expect(launches()).toHaveLength(1)
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Test fullscreen player')?.destroy() })
})

test('the saved Playback setting disables autoplay and its notification', async () => {
  if (playerPort) await fetch(`http://127.0.0.1:${playerPort}/test/quit`)
  const launchesBefore = existsSync(playerLog) ? launches().length : 0
  await page.evaluate(() => { window.location.hash = '/settings/playback' })
  await page.locator('[data-test="auto-next"] input').uncheck()
  await expect.poll(async () => (await (await api('GET', '/settings')).json() as { autoPlayNext: boolean }).autoPlayNext).toBe(false)
  const files = await (await api('GET', '/library/files?kind=episode&limit=50')).json() as { items: { id: number; episode: number }[] }
  const first = files.items.find((file) => file.episode === 1)!
  await page.evaluate(async (fileId) => {
    await (window as unknown as { theama: { players: { play(request: { fileId: number }): Promise<unknown> } } }).theama.players.play({ fileId })
  }, first.id)
  playerPort = Number(launches().at(-1)!.args.find((arg) => arg.startsWith('--http-port='))!.split('=')[1])
  await expect.poll(async () => (await current().catch(() => ({ file: '' }))).file).toContain('S01E01')
  await fetch(`http://127.0.0.1:${playerPort}/test/finish`)
  await page.waitForTimeout(8000) // Beyond EOF and the configured countdown: nothing should start.
  expect(app.windows().some((window) => window.url().includes('/next-episode-notification'))).toBe(false)
  expect((await current()).file).toContain('S01E01')
  expect(launches()).toHaveLength(launchesBefore + 1)
  await page.reload()
  await expect(page.locator('[data-test="auto-next"] input')).not.toBeChecked()
})
