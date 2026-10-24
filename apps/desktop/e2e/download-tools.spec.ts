import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { DownloadTool, DownloadToolsStatus } from '@theama/contracts'

let app: ElectronApplication
let page: Page
let dataDir: string
let userData: string
let base: string
let token: string
type FakeTools = { state: DownloadToolsStatus['vpn']['state']; running: boolean; opened: DownloadTool[]; calls: number; error: boolean }

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'theama-tools-data-'))
  userData = mkdtempSync(join(tmpdir(), 'theama-tools-profile-'))
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: join(import.meta.dirname, '..'), env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string> })
  page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  base = `http://127.0.0.1:${(JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port: number }).port}`
  token = readFileSync(join(dataDir, 'secrets', 'api-token'), 'utf8').trim()
  // Replace handlers from the test process. No production test hooks or real app launches are needed.
  await app.evaluate(({ ipcMain }) => {
    const fake: FakeTools = { state: 'disconnected', running: true, opened: [], calls: 0, error: false }
    Object.assign(globalThis, { downloadToolsFake: fake })
    ipcMain.removeHandler('downloadTools:status')
    ipcMain.removeHandler('downloadTools:open')
    ipcMain.handle('downloadTools:status', () => {
      fake.calls++
      return { vpn: { state: fake.state, reason: fake.state === 'connected' ? 'verified' : fake.state === 'disconnected' ? 'no_tunnel' : 'check_failed', checkedAt: Date.now() }, tools: {
        nordvpn: { installed: true, running: true }, qbittorrent: { installed: true, running: fake.running }, prowlarr: { installed: true, running: false },
      } }
    })
    ipcMain.handle('downloadTools:open', (_event, { tool }: { tool: DownloadTool }) => {
      fake.opened.push(tool)
      if (tool === 'qbittorrent') fake.running = true
      return fake.error ? { ok: false, code: 'not_installed' } : { ok: true, code: null }
    })
  })
})

test.afterAll(async () => {
  await app?.close()
  for (const path of [dataDir, userData]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-tools-(data|profile)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
})

async function fake(patch: Partial<FakeTools>): Promise<void> {
  await app.evaluate((_electron, update) => {
    Object.assign((globalThis as unknown as { downloadToolsFake: FakeTools }).downloadToolsFake, update)
  }, patch)
}
async function navigate(path: string): Promise<void> {
  await page.evaluate((hash) => { window.location.hash = hash }, path)
}

test.beforeEach(async () => {
  await fake({ state: 'disconnected', running: true, error: false, opened: [] })
  await navigate('/downloads')
  await expect(page.locator('[data-test="vpn-refresh"]')).toBeEnabled()
  await page.locator('[data-test="vpn-refresh"]').click()
})

test('shows connection warnings and all three launch buttons without blocking downloads', async () => {
  await navigate('/downloads')
  const panel = page.locator('[data-test="download-tools"]')
  await expect(panel.locator('[data-test="vpn-status"]')).toContainText('NordVPN is disconnected')
  await expect(panel.locator('[data-test="vpn-warning"]')).toBeVisible()
  for (const tool of ['nordvpn', 'qbittorrent', 'prowlarr']) {
    await panel.locator(`[data-test="open-${tool}"]`).click()
  }
  expect(await app.evaluate(() => (globalThis as unknown as { downloadToolsFake: FakeTools }).downloadToolsFake.opened)).toEqual(['nordvpn', 'qbittorrent', 'prowlarr'])
  await expect(page.locator('[data-test="find-title"]')).toBeEnabled()
  await fake({ state: 'connected' })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(panel.locator('[data-test="vpn-status"]')).toContainText('NordVPN connection verified')
  await expect(panel.locator('[data-test="vpn-warning"]')).toHaveCount(0)
  await fake({ state: 'unknown' })
  await panel.locator('[data-test="vpn-refresh"]').click()
  await expect(panel.locator('[data-test="vpn-status"]')).toContainText('Connection could not be verified')
  await expect(panel.locator('[data-test="vpn-warning"]')).toBeVisible()
})

test('shows status with qBittorrent closed, warns after launch, and exposes failures', async () => {
  await fake({ state: 'disconnected', running: false })
  await page.locator('[data-test="vpn-refresh"]').click()
  await expect(page.locator('[data-test="vpn-status"]')).toContainText('NordVPN is disconnected')
  await expect(page.locator('[data-test="vpn-warning"]')).toHaveCount(0)
  await page.locator('[data-test="open-qbittorrent"]').click()
  await expect(page.locator('[data-test="vpn-warning"]')).toBeVisible()
  await fake({ error: true })
  await page.locator('[data-test="open-prowlarr"]').click()
  await expect(page.locator('[data-test="tool-error"]')).toContainText('not found')
  await fake({ error: false })
})

test('does not claim local VPN verification protects a remote qBittorrent instance', async () => {
  await page.route('**/api/v1/downloads/status', (route) => route.fulfill({ json: {
    state: 'connected', url: 'http://nas.example:8080', username: 'admin', version: 'v5.0.0', webApiVersion: '2.11', message: null,
  } }))
  await fake({ state: 'connected', running: false })
  await navigate('/settings/downloads')
  await expect(page.locator('[data-test="vpn-warning"]')).toContainText('remote qBittorrent')
  await expect(page.locator('[data-test="vpn-status"]')).toContainText('Connection could not be verified')
  await page.unroute('**/api/v1/downloads/status')
})

test('keeps the panel on Downloads Settings only, with accessible English and Greek warnings', async () => {
  await navigate('/settings/downloads')
  await expect(page.locator('[data-test="download-tools"]')).toContainText('split tunneling')
  for (const [language, theme] of [['en', 'dark'], ['el', 'light']] as const) {
    const res = await fetch(`${base}/api/v1/settings`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ language, theme }) })
    expect(res.ok).toBe(true)
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    await expect(page.locator('[data-test="vpn-warning"]')).toBeVisible()
    if (language === 'el') await expect(page.locator('[data-test="open-nordvpn"]')).toHaveText('Άνοιγμα NordVPN')
    const audit = await new AxeBuilder({ page }).setLegacyMode().include('[data-test="download-tools"]').analyze()
    expect(audit.violations).toEqual([])
  }
  await navigate('/movies')
  await expect(page.locator('[data-test="download-tools"]')).toHaveCount(0)
  const calls = await app.evaluate(() => (globalThis as unknown as { downloadToolsFake: FakeTools }).downloadToolsFake.calls)
  // Advance the renderer's timers without waiting ten real seconds.
  await page.clock.install()
  await page.clock.fastForward(30_000)
  expect(await app.evaluate(() => (globalThis as unknown as { downloadToolsFake: FakeTools }).downloadToolsFake.calls)).toBe(calls)
})
