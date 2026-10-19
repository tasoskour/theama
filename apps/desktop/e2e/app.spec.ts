import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

/**
 * Smoke test of the whole stack: Electron shell -> app:// UI -> auth header
 * injection -> real server process (spawned by the dev service controller) ->
 * SQLite -> log history. It uses a throw-away data directory and port.
 */
let app: ElectronApplication
let page: Page
let dataDir: string
let userDataDir: string
let mediaRoot: string
let mediaFolder: string

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'theama-e2e-'))
  // Own Chromium profile: isolates the test from a Theama the developer may have open (single-instance lock, caches).
  userDataDir = mkdtempSync(join(tmpdir(), 'theama-e2e-profile-'))
  // A media folder with a Greek name, answered to the folder picker through the dev-only test hook.
  mediaRoot = mkdtempSync(join(tmpdir(), 'theama-media-'))
  mediaFolder = join(mediaRoot, 'Ταινίες')
  mkdirSync(mediaFolder)
  writeFileSync(join(mediaFolder, 'Interstellar (2014).mkv'), 'x')
  // VS Code (and some CI shells) export ELECTRON_RUN_AS_NODE, which turns electron.exe into plain Node.
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_TEST_PICK_FOLDER: mediaFolder, THEAMA_FFPROBE: 'none' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: join(import.meta.dirname, '..'),
    env: Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>,
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
})

test.afterAll(async () => {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
  await rm(mediaRoot, { recursive: true, force: true }).catch(() => undefined)
})

const nav = (name: string) => page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name })

test('opens, connects to the backend and shows the shell', async () => {
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Welcome to Theama' })).toBeVisible()
})

test('the renderer is sandboxed and exposes only the typed bridge', async () => {
  const exposed = await page.evaluate(() => ({
    bridge: typeof (window as unknown as { theama?: unknown }).theama,
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
  }))
  expect(exposed).toEqual({ bridge: 'object', require: 'undefined', process: 'undefined' })
})

test('every main section renders its empty state', async () => {
  for (const [link, heading] of [
    ['Movies', 'No movies yet'],
    ['Series', 'No series yet'],
    ['My Videos', 'No personal videos yet'],
    ['Search', 'Search'],
  ] as const) {
    await nav(link).click()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    // Regression: the call to action was hidden by Vue's Boolean prop casting.
    // (Search has no call to action: it explains itself instead.)
    if (link !== 'Search') await expect(page.getByRole('button', { name: 'Add a folder' })).toBeVisible()
  }
})

test('adds a media folder (Greek name), shows it online, changes its type and removes it without touching files', async () => {
  const folder = mediaFolder
  try {
    await nav('Movies').click()
    // Wait for the new page: during the 160 ms page transition the old page's button is still on screen but inert.
    await expect(page.getByRole('heading', { name: 'No movies yet' })).toBeVisible()
    await page.getByRole('button', { name: 'Add a folder' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a media folder' })
    await expect(dialog.getByRole('textbox', { name: 'Folder path' })).toHaveValue(folder)
    // Adding from the Movies page defaults the type to Movies.
    await expect(dialog.getByRole('button', { name: 'Movies', pressed: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Add folder' }).click()

    await expect(page.getByText('Folder added', { exact: true })).toBeVisible()

    // Adding a folder starts a scan; the detected video appears as a poster card titled from its name.
    const film = page.getByRole('link', { name: 'Interstellar, 2014' })
    await expect(film).toBeVisible({ timeout: 30_000 })
    await expect(film.getByText('Offline')).toHaveCount(0)

    // Open it: details with the guessed title, the file's facts, and a way back that restores focus to the card.
    await film.click()
    await expect(page.getByRole('heading', { name: 'Interstellar', level: 1 })).toBeVisible()
    await expect(page.getByText('Interstellar (2014).mkv').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Movies', level: 1 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Interstellar, 2014' })).toBeFocused()

    await page.goto(page.url().split('#')[0] + '#/settings/library')
    const row = page.locator('li.source', { hasText: folder })
    await expect(row).toBeVisible()
    await expect(row.getByText('Online', { exact: true })).toBeVisible()
    await expect(row).toContainText('Found 1 · 1 new')
    // FFprobe is switched off for this run, and the page says so instead of silently showing no details.
    await expect(page.getByText(/FFprobe was not found/).first()).toBeVisible()

    // Rename the file on disk, rescan: recognised as the same file (renamed), not a new one plus a missing one.
    await rename(join(folder, 'Interstellar (2014).mkv'), join(folder, 'Interstellar Ταινία (2014).mkv'))
    await row.getByRole('button', { name: 'Scan now' }).click()
    await expect(row).toContainText('1 renamed or moved', { timeout: 30_000 })
    await expect(row).toContainText('0 missing')

    // Unplug the drive: the folder shows offline and its video stays in the list, dimmed and labelled.
    const away = join(mediaRoot, 'unplugged')
    await rename(folder, away)
    await page.goto(page.url().split('#')[0] + '#/settings/library')
    await page.reload()
    await expect(row.getByText('Offline', { exact: true })).toBeVisible({ timeout: 30_000 })
    await nav('Movies').click()
    // The file was renamed above, so the title is now "Interstellar Ταινία".
    const dimmed = page.getByRole('link', { name: 'Interstellar Ταινία, 2014, Offline' })
    await expect(dimmed).toBeVisible()
    await expect(dimmed.getByText('Offline', { exact: true })).toBeVisible()
    await page.getByLabel('Hide unavailable').check({ force: true })
    await expect(page.getByText('Nothing matches.')).toBeVisible()
    await page.getByLabel('Hide unavailable').uncheck({ force: true })

    // Search finds it even while offline, in Greek without accents or capitals.
    await nav('Search').click()
    await page.getByRole('textbox', { name: 'Search your library' }).fill('ΤΑΙΝΙΑ')
    await expect(page.getByRole('link', { name: 'Interstellar Ταινία, 2014, Offline' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Search your library' }).fill('interstel')
    await expect(page.getByRole('link', { name: 'Interstellar Ταινία, 2014, Offline' })).toBeVisible()
    await nav('Movies').click()

    // Plug it back in: online again, nothing was lost.
    await rename(away, folder)
    await page.goto(page.url().split('#')[0] + '#/settings/library')
    await page.reload()
    await expect(row.getByText('Online', { exact: true })).toBeVisible({ timeout: 30_000 })
    await nav('Movies').click()
    await expect(page.getByRole('link', { name: 'Interstellar Ταινία, 2014' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Interstellar Ταινία, 2014, Offline' })).toHaveCount(0)
    await page.goto(page.url().split('#')[0] + '#/settings/library')

    // The same folder cannot be added twice.
    await page.getByRole('button', { name: 'Add folder' }).first().click()
    await page.getByRole('dialog', { name: 'Add a media folder' }).getByRole('button', { name: 'Add folder' }).click()
    await expect(page.getByText('That folder has already been added.')).toBeVisible()
    await page.getByRole('dialog', { name: 'Add a media folder' }).getByRole('button', { name: 'Cancel' }).click()

    // Change the type, then remove.
    await row.locator('.type-select .v-field').click()
    await page.getByRole('option', { name: 'My Videos' }).click()
    await expect(row.locator('.type-select')).toContainText('My Videos')

    await row.getByRole('button', { name: new RegExp(`^Remove: `) }).click()
    await page.getByRole('dialog', { name: 'Remove this folder from Theama?' }).getByRole('button', { name: 'Remove folder' }).click()
    await expect(page.getByText('Folder removed from Theama', { exact: true })).toBeVisible()
    await expect(page.getByText('No folders yet.')).toBeVisible()
    expect(existsSync(join(folder, 'Interstellar Ταινία (2014).mkv'))).toBe(true)
  } finally {
    // mediaRoot is removed in afterAll
  }
})

test('keyboard: "/" opens search', async () => {
  await nav('Home').click()
  await page.keyboard.press('/')
  await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Search your library' })).toBeFocused()
})

test('service page shows the running backend and its start history', async () => {
  await page.getByRole('link', { name: 'Settings' }).first().click()
  await page.getByRole('tab', { name: 'Service' }).or(page.getByRole('link', { name: 'Advanced' })).first().click()
  await page.goto(page.url().split('#')[0] + '#/settings/advanced/service')
  await expect(page.getByText('Running', { exact: true })).toBeVisible()
  await expect(page.getByText('Development process').first()).toBeVisible()
  await expect(page.getByText('Started', { exact: true }).first()).toBeVisible()
})

test('log history lists entries from the service', async () => {
  await page.goto(page.url().split('#')[0] + '#/settings/advanced/logs')
  // The history is virtualised and newest-first: recent activity (scans, folder changes) is listed too.
  await page.getByRole('textbox', { name: 'Search messages' }).fill('Scan finished')
  await expect(page.getByText(/Scan finished/).first()).toBeVisible()
  await page.getByRole('textbox', { name: 'Search messages' }).fill('listening')
  await expect(page.getByText(/Theama server .* listening/).first()).toBeVisible()
  await page.getByRole('textbox', { name: 'Search messages' }).fill('no-such-message-xyz')
  await expect(page.getByText('No log entries match.')).toBeVisible()
})

test('stopping the service shows the recovery screen, starting it recovers', async () => {
  await page.goto(page.url().split('#')[0] + '#/settings/advanced/service')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByRole('heading', { name: 'Theama cannot reach its background service' })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText('Recent log lines')).toBeVisible()
  await page.getByRole('button', { name: 'Start service' }).click()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
})

test('switches to Greek without a restart and the choice persists to the API', async () => {
  await page.goto(page.url().split('#')[0] + '#/settings/general')
  await page.getByRole('button', { name: 'Ελληνικά' }).click()
  await expect(page.getByRole('heading', { name: 'Ρυθμίσεις', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Κύρια πλοήγηση' }).getByRole('link', { name: 'Ταινίες' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'el')
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Κύρια πλοήγηση' })).toBeVisible({ timeout: 30_000 })
})

test('toggles between dark and light themes', async () => {
  await page.goto(page.url().split('#')[0] + '#/settings/general')
  await page.getByRole('button', { name: 'Ανοιχτό' }).click()
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--theamaLight/)
  await page.getByRole('button', { name: 'Σκούρο' }).click()
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--theamaDark/)
})

test('mobile width switches to bottom navigation', async () => {
  await page.setViewportSize({ width: 420, height: 800 })
  await expect(page.locator('.v-bottom-navigation')).toBeVisible()
  await expect(page.locator('.v-navigation-drawer')).toHaveCount(0)
})
