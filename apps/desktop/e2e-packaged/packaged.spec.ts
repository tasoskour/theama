import { dismissInitialSetup } from '../e2e/setup-helper'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

/**
 * Smoke test of the PACKAGED app (build/installer/win-unpacked, made by "yarn pack:dir"): the shipped Electron
 * binary, the interface served from resources/, the bundled Node.js running the bundled backend with its native
 * SQLite module, FFprobe found next to it, and a restore + restart cycle. It runs the backend as a plain child of
 * the app (THEAMA_CONTROLLER=process) because installing a Windows service needs an administrator's approval.
 */
const exe = join(import.meta.dirname, '..', '..', '..', 'build', 'installer', 'win-unpacked', 'Theama.exe')

let app: ElectronApplication
let page: Page
let dataDir: string
let userData: string
let media: string

test.beforeAll(async () => {
  expect(existsSync(exe), `Build the unpacked app first: yarn pack:dir (${exe})`).toBe(true)
  dataDir = mkdtempSync(join(tmpdir(), 'theama-pk-data-'))
  userData = mkdtempSync(join(tmpdir(), 'theama-pk-profile-'))
  media = mkdtempSync(join(tmpdir(), 'theama-pk-media-'))
  mkdirSync(join(media, 'Ταινίες'))
  for (const f of ['Interstellar (2014).mkv', 'Dune.2021.mkv']) writeFileSync(join(media, 'Ταινίες', f), 'x')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  Object.assign(env, { THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'process' })
  app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${userData}`], env })
  page = await app.firstWindow()
  await dismissInitialSetup(page)
})

test.afterAll(async () => {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
  await rm(media, { recursive: true, force: true }).catch(() => undefined)
})

const token = (): string => readFileSync(join(dataDir, 'secrets', 'api-token'), 'utf8').trim()
const base = (): string => `http://127.0.0.1:${(JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port: number }).port}/api/v1`
const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${base()}${path}`, { ...init, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })

test('the packaged app opens, starts its bundled backend and shows the interface', async () => {
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('heading', { name: 'Welcome to Theama' })).toBeVisible()
  // The window title and the shipped icon are the app's own.
  expect(await page.title()).toContain('Theama')
})

test('the backend runs on the bundled Node.js with its native database module, and finds the bundled FFprobe', async () => {
  const info = (await (await api('/system/info')).json()) as { nodeVersion: string; schemaVersion: number }
  expect(info.nodeVersion).toBe(readFileSync(join(import.meta.dirname, '..', '..', '..', 'build', 'installer', 'win-unpacked', 'resources', 'node', 'VERSION.txt'), 'utf8').trim())
  expect(info.schemaVersion).toBeGreaterThanOrEqual(7)
  const report = await (await api('/diagnostics/report')).text()
  expect(report).toContain('FFprobe: found')
  expect(report).toContain(dataDir)
})

test('adds a folder with a Greek name, scans it, and lists the films', async () => {
  const added = await api('/library/sources', { method: 'POST', body: JSON.stringify({ path: join(media, 'Ταινίες'), libraryType: 'movies' }) })
  expect(added.status).toBe(201)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Movies' }).click()
  await expect(page.getByRole('link', { name: 'Interstellar, 2014' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: 'Dune, 2021' })).toBeVisible()
})

test('settings pages and the service page render from the packaged resources', async () => {
  await page.goto(page.url().split('#')[0] + '#/settings/advanced/service')
  await expect(page.getByText(/Running/).first()).toBeVisible()
  await page.goto(page.url().split('#')[0] + '#/settings/advanced/about')
  await expect(page.getByText('Database schema')).toBeVisible()
  await page.goto(page.url().split('#')[0] + '#/settings/advanced/backup')
  await expect(page.getByRole('heading', { name: 'Backup and restore' })).toBeVisible()
})

test('a backup can be made and restored; the service restarts onto the restored library', async () => {
  await page.locator('[data-test="backup-now"]').click()
  await expect(page.locator('[data-test="backup-list"] li').first()).toBeVisible()

  // Change the library, then restore the backup from the page and let the app restart its service.
  expect((await api('/collections', { method: 'POST', body: JSON.stringify({ name: 'Made after the backup' }) })).status).toBe(201)
  const manual = page.locator('[data-test="backup-list"] li', { hasText: 'Made by you' }).first()
  await manual.locator('[data-test="restore-backup"]').click()
  await page.locator('[data-test="confirm-restore"]').click()
  await expect(page.locator('[data-test="restore-pending"]')).toBeVisible()
  await page.locator('[data-test="restart-now"]').click()
  await expect(page.locator('[data-test="restore-pending"]')).toHaveCount(0, { timeout: 90_000 })

  const mine = (await (await api('/collections?kind=user')).json()) as { items: unknown[] }
  expect(mine.items).toHaveLength(0) // the collection made after the backup is gone
  const titles = (await (await api('/library/titles?limit=50')).json()) as { items: { title: string }[] }
  expect(titles.items.map((t) => t.title).sort()).toEqual(['Dune', 'Interstellar'])
  const backups = (await (await api('/backups')).json()) as { items: { kind: string }[] }
  expect(backups.items.some((b) => b.kind === 'pre-restore')).toBe(true)
})

test('what ships: licences and notices are next to the app', () => {
  const resources = join(import.meta.dirname, '..', '..', '..', 'build', 'installer', 'win-unpacked', 'resources')
  for (const f of ['THIRD-PARTY-NOTICES.txt', join('ffprobe', 'LICENSE-ffmpeg.txt'), join('node', 'VERSION.txt'), join('nssm', 'service-admin.ps1'), join('nssm', 'installer-helper.ps1')]) {
    expect(existsSync(join(resources, f)), f).toBe(true)
  }
  expect(readFileSync(join(resources, 'THIRD-PARTY-NOTICES.txt'), 'utf8')).toContain('not endorsed or certified by TMDB')
})
