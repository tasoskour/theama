import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../tools/fake-tmdb/server.mjs'

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
let fake: FakeTmdb
let playerLog: string

test.beforeAll(async () => {
  // TMDB is replaced by a local stand-in, so the test needs no key, no network and cannot hit the real service.
  fake = await startFakeTmdb()
  dataDir = mkdtempSync(join(tmpdir(), 'theama-e2e-'))
  playerLog = join(dataDir, 'players.log')
  // Own Chromium profile: isolates the test from a Theama the developer may have open (single-instance lock, caches).
  userDataDir = mkdtempSync(join(tmpdir(), 'theama-e2e-profile-'))
  // A media folder with a Greek name, answered to the folder picker through the dev-only test hook.
  mediaRoot = mkdtempSync(join(tmpdir(), 'theama-media-'))
  mediaFolder = join(mediaRoot, 'Ταινίες')
  mkdirSync(mediaFolder)
  writeFileSync(join(mediaFolder, 'Interstellar (2014).mkv'), 'x')
  // VS Code (and some CI shells) export ELECTRON_RUN_AS_NODE, which turns electron.exe into plain Node.
  const env: NodeJS.ProcessEnv = { ...process.env, THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_TEST_PICK_FOLDER: mediaFolder, THEAMA_FFPROBE: 'none', THEAMA_TEST_PLAYER_LOG: playerLog, THEAMA_TEST_TRAILER_URL: 'data:text/html,<title>fake trailer</title><body style="background:%23123">', THEAMA_TMDB_API_BASE: fake.url, THEAMA_TMDB_IMAGE_BASE: fake.imageUrl }
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
  await fake.close()
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

test('uses the integrated desktop header without a native menu', async () => {
  await expect(page.locator('.topnav')).toBeVisible()
  await expect(page.locator('.v-navigation-drawer')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(7)
  const chrome = await app.evaluate(({ BrowserWindow, Menu }) => ({
    applicationMenu: Menu.getApplicationMenu() !== null,
    menuVisible: BrowserWindow.getAllWindows()[0]?.isMenuBarVisible() ?? true,
    background: BrowserWindow.getAllWindows()[0]?.getBackgroundColor(),
  }))
  expect(chrome.applicationMenu).toBe(false)
  expect(chrome.menuVisible).toBe(false)
  expect(['#0F0E0C', '#F6F1E7']).toContain(chrome.background)
})

test('desktop navigation shortcuts work without the native menu', async () => {
  await page.keyboard.press('Control+2')
  await expect(page).toHaveURL(/#\/movies$/)
  await page.keyboard.press('Control+5')
  await expect(page).toHaveURL(/#\/collections$/)
  await page.keyboard.press('Control+,')
  await expect(page).toHaveURL(/#\/settings\/general$/)
  await page.keyboard.press('Control+Shift+L')
  await expect(page).toHaveURL(/#\/settings\/advanced\/logs$/)
  await page.keyboard.press('Control+1')
  await expect(page).toHaveURL(/#\/$/)
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

    // A populated section keeps the add action visible, so more media folders can be added.
    const addAnotherFolder = page.locator('.page-header').getByRole('button', { name: 'Add folder' })
    await expect(addAnotherFolder).toBeVisible()
    await addAnotherFolder.click()
    await expect(page.getByRole('dialog', { name: 'Add a media folder' })).toBeVisible()
    await page.getByRole('dialog', { name: 'Add a media folder' }).getByRole('button', { name: 'Cancel' }).click()

    // Open it: details with the guessed title, the file's facts, and a way back that restores focus to the card.
    await film.click()
    await expect(page.getByRole('heading', { name: 'Interstellar', level: 1 })).toBeVisible()
    const detailColumns = await page.locator('.hero').evaluate((hero) => {
      const poster = hero.querySelector('.hero__poster')!.getBoundingClientRect()
      const art = hero.querySelector('.hero__poster .art')!.getBoundingClientRect()
      const info = hero.querySelector('.hero__info')!.getBoundingClientRect()
      return {
        posterLeft: poster.left,
        posterRight: poster.right,
        artLeft: art.left,
        artRight: art.right,
        infoLeft: info.left,
        infoWidth: info.width,
      }
    })
    expect(detailColumns.posterRight).toBeLessThan(detailColumns.infoLeft)
    expect(detailColumns.artLeft).toBeGreaterThanOrEqual(detailColumns.posterLeft)
    expect(detailColumns.artRight).toBeLessThanOrEqual(detailColumns.posterRight)
    expect(detailColumns.infoWidth).toBeGreaterThan(300)
    await expect(page.getByText('Interstellar (2014).mkv').first()).toBeVisible()
    await expect(page.locator('[data-test="play"]')).toBeEnabled() // a real Play button now (the shell here has pretend players)
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
    await page.locator('.head').getByRole('button', { name: 'Add folder' }).click()
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

test('identifies titles with TMDB: key set-up, posters, details, and choosing between look-alikes', async () => {
  // The previous test removed the folder from Theama, not from disk: start again with different files.
  for (const f of await readdir(mediaFolder)) await rm(join(mediaFolder, f), { force: true })
  for (const f of ['Interstellar (2014).mkv', 'Doctor.Who.S01E01.mkv', 'Severance.S01E01.mkv']) writeFileSync(join(mediaFolder, f), 'x')

  const here = page.url().split('#')[0]
  await page.goto(here + '#/settings/library')
  await page.getByRole('button', { name: 'Add folder' }).first().click()
  const add = page.getByRole('dialog', { name: 'Add a media folder' })
  await add.getByRole('button', { name: 'Auto-detect' }).click()
  await add.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByText('Folder added', { exact: true })).toBeVisible()

  // Without a key nothing is looked up, and Home says how to improve things.
  await nav('Home').click()
  await expect(page.getByText('Make your library look the part')).toBeVisible({ timeout: 30_000 })
  expect(fake.requests).toHaveLength(0)

  // Settings -> Metadata: a wrong key is refused, the right one is accepted and never shown again.
  await page.goto(here + '#/settings/metadata')
  await expect(page.getByRole('heading', { name: 'Metadata', level: 2 })).toBeVisible()
  const keyBox = page.getByLabel('TMDB API key or read access token')
  await keyBox.fill('this-is-not-a-valid-key-0000000000')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('TMDB did not accept this key.')).toBeVisible()
  await keyBox.fill(GOOD_KEY)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('A key is saved.')).toBeVisible()
  await expect(page.getByText(GOOD_KEY)).toHaveCount(0)
  await expect(page.locator('[data-test="metadata-counts"] > div', { hasText: 'Identified' })).toContainText('2', { timeout: 30_000 })
  await expect(page.locator('[data-test="metadata-counts"] > div', { hasText: 'Need your choice' })).toContainText('1')

  // The movie card now shows real artwork served by the backend (the shell adds the token to the request).
  await nav('Movies').click()
  const film = page.getByRole('link', { name: 'Interstellar, 2014' })
  await expect(film).toBeVisible()
  await expect
    .poll(() => film.locator('img').evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)), { timeout: 30_000 })
    .toBeGreaterThan(0)
  await film.click()
  await expect(page.getByText('A team of explorers travel through a wormhole in space.')).toBeVisible()
  await expect(page.getByText('TMDB 8.4 · 35,000 votes')).toBeVisible()
  await expect(page.locator('[data-test="rating"]')).toHaveAttribute('role', 'link')
  await expect(page.locator('[data-test="imdb-link"]')).toHaveText(/IMDb/)
  await expect(page.locator('[data-test="trailer-play"]')).toHaveText(/Trailer/)
  await expect(page.locator('[data-test="trailer-link"]')).toHaveAttribute('aria-label', /YouTube/)

  // The trailer opens in a container on this page, with the video laid exactly over its video area, and closes again.
  const overlays = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)
  const before = await overlays()
  await page.locator('[data-test="trailer-play"]').click()
  await expect(page.locator('[data-test="trailer-dialog"]')).toBeVisible()
  await expect.poll(overlays).toBe(before + 1)
  const stage = (await page.locator('.trailer__stage').boundingBox())!
  const videoBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)!.getBounds())
  expect(Math.abs(videoBounds.x - stage.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(videoBounds.y - stage.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(videoBounds.width - stage.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(videoBounds.height - stage.height)).toBeLessThanOrEqual(1)
  await page.locator('[data-test="trailer-back"]').click()
  await expect(page.locator('[data-test="trailer-dialog"]')).toHaveCount(0)
  await expect.poll(overlays).toBe(before)
  // Escape closes it too, from the page.
  await page.locator('[data-test="trailer-play"]').click()
  await expect.poll(overlays).toBe(before + 1)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-test="trailer-dialog"]')).toHaveCount(0)
  await expect.poll(overlays).toBe(before)
  await expect(page.getByText('Identified automatically using TMDB')).toBeVisible()
  await expect(page.getByText('Matthew McConaughey')).toBeVisible()
  await expect(page.getByRole('button', { name: /Christopher Nolan/ })).toBeVisible()
  await page.getByRole('button', { name: /Matthew McConaughey/ }).hover()
  await expect(page.getByText('No other available movies or series with this person are in your library.')).toBeVisible()

  // A series: provider episode names replace the guess from the file name.
  await nav('Series').click()
  await page.getByRole('link', { name: /^Severance/ }).click()
  await expect(page.getByRole('heading', { name: 'Severance', level: 1 })).toBeVisible()
  await expect(page.getByText('Good News About Hell').first()).toBeVisible()
  await expect(page.getByText('Mark leads a team of office workers')).toBeVisible()
  await expect(page.locator('[data-test="rating"]')).toContainText('TMDB 8.4')
  await expect(page.locator('[data-test="imdb-link"]')).toBeVisible()
  await expect(page.locator('[data-test="trailer-link"]')).toBeVisible()

  // Two different shows share a name: Theama asks instead of guessing, and the answer is locked.
  await nav('Series').click()
  const who = page.getByRole('link', { name: /^Doctor Who.*Not identified/ })
  await expect(who).toBeVisible()
  await who.click()
  await expect(page.getByText('Which one is this?')).toBeVisible()
  await page.getByRole('button', { name: 'Choose' }).click()
  const identify = page.getByRole('dialog', { name: 'Identify this title' })
  await expect(identify.getByRole('listitem')).toHaveCount(2)
  const searchesBeforeTyping = fake.requests.filter((request) => request.path === '/search/tv').length
  const providerSearch = identify.getByRole('textbox', { name: 'Search series' })
  await providerSearch.fill('D')
  await providerSearch.fill('Doctor')
  await providerSearch.fill('Doctor Who')
  await expect.poll(() => fake.requests.filter((request) => request.path === '/search/tv').length).toBe(searchesBeforeTyping + 1)
  await expect(identify.getByRole('listitem')).toHaveCount(2)
  const candidateGeometry = await identify.locator('[data-test="identify-candidate"]').evaluateAll((rows) =>
    rows.map((row) => {
      const box = row.getBoundingClientRect()
      const art = row.querySelector('.cand__art .art')!.getBoundingClientRect()
      const info = row.querySelector('.cand__info')!.getBoundingClientRect()
      return { boxLeft: box.left, boxRight: box.right, artLeft: art.left, artRight: art.right, infoLeft: info.left }
    }),
  )
  for (const candidate of candidateGeometry) {
    expect(candidate.artLeft).toBeGreaterThanOrEqual(candidate.boxLeft)
    expect(candidate.artRight).toBeLessThan(candidate.infoLeft)
    expect(candidate.artRight).toBeLessThanOrEqual(candidate.boxRight)
  }
  const originalWindowSize = await app.evaluate(({ BrowserWindow }) => {
    const [width, height] = BrowserWindow.getAllWindows()[0]!.getSize()
    return { width, height }
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(560, 800))
  const narrowCandidate = identify.locator('[data-test="identify-candidate"]').first()
  await expect(narrowCandidate).toBeVisible()
  const narrowGeometry = await narrowCandidate.evaluate((row) => {
    const box = row.getBoundingClientRect()
    const art = row.querySelector('.cand__art .art')!.getBoundingClientRect()
    const info = row.querySelector('.cand__info')!.getBoundingClientRect()
    const action = row.querySelector('.v-btn')!.getBoundingClientRect()
    return { boxRight: box.right, boxBottom: box.bottom, artRight: art.right, infoLeft: info.left, actionRight: action.right, actionBottom: action.bottom }
  })
  expect(narrowGeometry.artRight).toBeLessThan(narrowGeometry.infoLeft)
  expect(narrowGeometry.actionRight).toBeLessThanOrEqual(narrowGeometry.boxRight)
  expect(narrowGeometry.actionBottom).toBeLessThanOrEqual(narrowGeometry.boxBottom)
  await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0]!.setSize(width!, height!), originalWindowSize)
  await identify.getByRole('button', { name: 'This one: Doctor Who 2005' }).click()
  await expect(identify).toBeHidden()
  await expect(page.getByText('The revived series.')).toBeVisible()
  await expect(page.getByText('Identified by you using TMDB')).toBeVisible()
  await expect(page.getByText('Locked', { exact: true })).toBeVisible()
  await expect(page.getByText('Rose').first()).toBeVisible()

  // Tidy up so the following tests start from an empty library.
  await page.goto(here + '#/settings/library')
  const row = page.locator('li.source', { hasText: mediaFolder })
  await row.getByRole('button', { name: new RegExp('^Remove: ') }).click()
  await page.getByRole('dialog', { name: 'Remove this folder from Theama?' }).getByRole('button', { name: 'Remove folder' }).click()
  await expect(page.getByText('No folders yet.')).toBeVisible()
})

test('shows what a series is missing, and builds collections (official and your own)', async () => {
  // The TMDB key from the previous test is still saved; this library has two Mad Max films and a gappy series.
  for (const f of await readdir(mediaFolder)) await rm(join(mediaFolder, f), { force: true })
  for (const f of ['Mad.Max.1979.mkv', 'Mad.Max.Fury.Road.2015.mkv', 'Severance.S01E01.mkv', 'Severance.S01E03.mkv', 'Severance.S01E09.mkv']) {
    writeFileSync(join(mediaFolder, f), 'x')
  }
  const here = page.url().split('#')[0]
  await page.goto(here + '#/settings/library')
  await page.getByRole('button', { name: 'Add folder' }).first().click()
  const add = page.getByRole('dialog', { name: 'Add a media folder' })
  await add.getByRole('button', { name: 'Auto-detect' }).click()
  await add.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByText('Folder added', { exact: true })).toBeVisible()

  // --- a series with gaps ---------------------------------------------------------------
  await nav('Series').click()
  const card = page.getByRole('link', { name: /^Severance.*2 missing/ })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.click()
  await expect(page.getByRole('heading', { name: 'Severance', level: 1 })).toBeVisible()
  await expect(page.locator('[data-test="missing-chip"]')).toContainText('2 missing')

  // Season 1: 3 expected, 2 in the library; the aired gap is marked, and a file TMDB does not list stays visible.
  await expect(page.locator('[data-test="season-summary"]')).toContainText('3 expected · 2 in your library · 1 missing')
  const gap = page.locator('li[data-gap="missing"]', { hasText: 'Half Loop' })
  await expect(gap).toContainText('Missing')
  await expect(gap.getByRole('button')).toHaveCount(0) // a gap is never an action
  await expect(page.getByText("Not in TMDB's list")).toBeVisible()

  // Season 2: one aired episode missing, one not aired yet — shown differently.
  await page.getByRole('tab', { name: /Season 2/ }).click()
  await expect(page.locator('li[data-gap="missing"]', { hasText: 'Hello, Ms. Cobel' })).toContainText('Missing')
  await expect(page.locator('li[data-gap="upcoming"]', { hasText: 'The Future Episode' })).toContainText('Airs 2099-01-01')

  // --- an official collection, with the parts the library lacks ---------------------------------
  await nav('Collections').click()
  const set = page.getByRole('link', { name: 'Mad Max Collection, 2 of 4 in your library' })
  await expect(set).toBeVisible({ timeout: 30_000 })
  await set.click()
  await expect(page.getByRole('heading', { name: 'Mad Max Collection', level: 1 })).toBeVisible()
  await expect(page.locator('[data-test="collection-count"]')).toContainText('2 of 4 in your library')
  await expect(page.locator('[data-test="contextual-member"]')).toHaveCount(2)
  await expect(page.locator('[data-test="contextual-member"]').first()).toContainText('Mad Max 2')
  await expect(page.locator('[data-test="contextual-member"]').first()).toContainText('Not in your library')
  // Release order only; no way to edit someone else's set.
  await expect(page.getByRole('button', { name: 'Rename' })).toHaveCount(0)

  // --- your own collection, started from a title page ------------------------------------------
  await page.getByRole('link', { name: /^Mad Max, 1979/ }).click()
  await expect(page.getByRole('heading', { name: 'Mad Max', level: 1 })).toBeVisible()
  await expect(page.locator('[data-test="part-of"]')).toContainText('Mad Max Collection')
  await page.locator('[data-test="add-to-collection"]').click()
  await page.locator('[data-test="new-collection"]').click()
  const create = page.getByRole('dialog', { name: 'New collection' })
  await create.getByLabel('Name').fill('Friday night')
  await create.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('[data-test="part-of"]')).toContainText('Friday night')

  await page.locator('[data-test="part-of"]').getByRole('link', { name: 'Friday night' }).click()
  await expect(page.getByRole('heading', { name: 'Friday night', level: 1 })).toBeVisible()
  await expect(page.locator('[data-test="collection-count"]')).toContainText('1 title')
  await page.locator('[data-test="rename-collection"]').click()
  const rename = page.getByRole('dialog', { name: 'Rename' })
  await rename.getByLabel('Name').fill('Movie night')
  await rename.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Movie night', level: 1 })).toBeVisible()

  // Collections turn up where people look: on Home, in search, and the arrow keys move between them.
  await nav('Home').click()
  await expect(page.locator('[data-test="collection-rail"]').getByRole('link', { name: /Movie night/ })).toBeVisible()
  await nav('Search').click()
  await page.getByRole('textbox', { name: 'Search your library' }).fill('movie nig')
  await expect(page.locator('[data-test="collection-results"]').getByRole('link', { name: /Movie night/ })).toBeVisible()
  await nav('Collections').click()
  await expect(page.getByRole('heading', { name: 'Collections', level: 1 })).toBeVisible() // the search page has left
  const firstCard = page.locator('[data-collection-id]').first()
  await firstCard.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-collection-id]').nth(1)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(firstCard).toBeFocused()
  await page.getByRole('link', { name: /Movie night/ }).click()
  await expect(page.getByRole('heading', { name: 'Movie night', level: 1 })).toBeVisible()

  // Deleting the collection never touches the title.
  await page.locator('[data-test="delete-collection"]').click()
  await page.getByRole('dialog', { name: /Delete/ }).getByRole('button', { name: 'Delete collection' }).click()
  await expect(page.getByRole('heading', { name: 'Collections', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Movie night/ })).toHaveCount(0)
  await nav('Movies').click()
  await expect(page.getByRole('link', { name: /^Mad Max, 1979/ })).toBeVisible()

  // Tidy up so the following tests start from an empty library.
  await page.goto(here + '#/settings/library')
  const row = page.locator('li.source', { hasText: mediaFolder })
  await row.getByRole('button', { name: new RegExp('^Remove: ') }).click()
  await page.getByRole('dialog', { name: 'Remove this folder from Theama?' }).getByRole('button', { name: 'Remove folder' }).click()
  await expect(page.getByText('No folders yet.')).toBeVisible()
})

test('starts a player on a video with the right subtitle, remembers what was watched, and offers the next episode', async () => {
  for (const f of await readdir(mediaFolder)) await rm(join(mediaFolder, f), { force: true })
  for (const f of ['Show.S01E01.mkv', 'Show.S01E02.mkv', 'Show.S01E01.el.srt', 'Show.S01E01.en.srt']) writeFileSync(join(mediaFolder, f), 'x')
  const here = page.url().split('#')[0]
  await page.goto(here + '#/settings/library')
  await page.getByRole('button', { name: 'Add folder' }).first().click()
  const add = page.getByRole('dialog', { name: 'Add a media folder' })
  await add.getByRole('button', { name: 'Auto-detect' }).click()
  await add.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByText('Folder added', { exact: true })).toBeVisible()

  // Settings -> Playback: the players found on this PC (pretend ones in this run), VLC first by default.
  await page.goto(here + '#/settings/playback')
  await expect(page.getByRole('heading', { name: 'Playback', level: 2 })).toBeVisible()
  await expect(page.locator('[data-test="player-row"]', { hasText: 'VLC media player' }).getByRole('radio')).toBeChecked()
  await expect(page.locator('[data-test="player-row"]', { hasText: 'mpv' })).toBeVisible()
  await expect(page.locator('[data-test="player-row"]', { hasText: 'System default' })).toBeVisible()
  await expect(page.getByText('Greek').first()).toBeVisible() // subtitle preferences start with Greek, then English

  // Play the series from its page: the first episode, with the Greek subtitle next to it, in VLC.
  await nav('Series').click()
  await page.getByRole('link', { name: /^Show/ }).click()
  await expect(page.getByRole('heading', { name: 'Show', level: 1 })).toBeVisible()
  await expect(page.locator('[data-test="play"]')).toHaveText(/Play S01E01/)
  const launches = () => (existsSync(playerLog) ? readFileSync(playerLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { exe: string; args: string[] }) : [])
  await page.locator('[data-test="play"]').click()
  await expect.poll(() => launches().length).toBe(1)
  expect(launches()[0]!.exe).toMatch(/VLC[\\/]vlc\.exe$/)
  expect(launches()[0]!.args).toEqual([`--sub-file=${join(mediaFolder, 'Show.S01E01.el.srt')}`, join(mediaFolder, 'Show.S01E01.mkv')])

  // Starting a video is not the same as having watched it.
  await expect(page.locator('[data-test="play"]')).toHaveText(/Play S01E01/)

  // Another player for this one run: mpv, with "--" before the file and the preferred languages.
  await page.locator('[data-test="play-with"]').click()
  await page.locator('.v-overlay-container .v-list-item', { hasText: 'mpv' }).click()
  await expect.poll(() => launches().length).toBe(2)
  expect(launches()[1]!.args).toEqual([`--sub-file=${join(mediaFolder, 'Show.S01E01.el.srt')}`, '--slang=el,en', '--', join(mediaFolder, 'Show.S01E01.mkv')])

  // A player that can report its position (the desktop shell forwards it): under five minutes is not remembered,
  // after that the button resumes from the minute, and from 90 % the episode counts as watched on its own.
  const api = (method: string, path: string, body?: unknown) =>
    page.evaluate(
      async ({ method, path, body }) => {
        const info = (await (window as unknown as { theama: { appInfo(): Promise<{ apiBase: string }> } }).theama.appInfo())
        const res = await fetch(`${info.apiBase}/api/v1${path}`, {
          method,
          headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        return (await res.json()) as unknown
      },
      { method, path, body },
    )
  const firstEpisode = ((await api('GET', '/library/files?kind=episode&limit=50')) as { items: { id: number; episode: number }[] }).items.find((f) => f.episode === 1)!
  expect(await api('PUT', `/playback/files/${firstEpisode.id}/progress`, { positionSeconds: 120, durationSeconds: 2700, final: true })).toEqual({ outcome: 'ignored' })
  await expect(page.locator('[data-test="play"]')).toHaveText(/Play S01E01/)
  expect(await api('PUT', `/playback/files/${firstEpisode.id}/progress`, { positionSeconds: 754, durationSeconds: 2700, final: true })).toEqual({ outcome: 'saved' })
  await expect(page.locator('[data-test="play"]')).toHaveText(/Resume S01E01 · 12:34/)
  await expect(page.locator('[data-test="stopped-at"]')).toHaveText(/Stopped at 12:34/)
  await page.locator('[data-test="play-with"]').click()
  await expect(page.locator('.v-overlay-container [data-test="play-from-start"]')).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await api('PUT', `/playback/files/${firstEpisode.id}/progress`, { positionSeconds: 2430, durationSeconds: 2700, final: true })).toEqual({ outcome: 'watched' })
  await expect(page.locator('[data-test="play"]')).toHaveText(/Play S01E02/)
  await api('PUT', `/playback/files/${firstEpisode.id}`, { watched: false })
  await expect(page.locator('[data-test="play"]')).toHaveText(/Play S01E01/)

  // Mark the first episode watched: the big button moves on, and Home offers to continue.
  await page.locator('[data-test="toggle-watched"]').first().click()
  await expect(page.locator('[data-test="play"]')).toHaveText(/Play S01E02/)
  await nav('Home').click()
  const resume = page.locator('[data-test="continue-rail"]')
  await expect(resume).toBeVisible()
  await expect(resume.getByRole('link', { name: /^Show/ })).toContainText('Next: S01E02')

  // Marking everything watched ends the rail, and the card says so.
  await resume.getByRole('link', { name: /^Show/ }).click()
  await page.locator('[data-test="watched-menu"]').click()
  await page.locator('[data-test="mark-all-watched"]').click()
  await expect(page.locator('[data-test="play"]')).toHaveText(/Play again/)
  await nav('Series').click()
  await expect(page.getByRole('link', { name: /^Show.*Watched/ })).toBeVisible()
  await nav('Home').click()
  await expect(page.locator('[data-test="continue-rail"]')).toHaveCount(0)

  // Tidy up so the following tests start from an empty library.
  await page.goto(here + '#/settings/library')
  const row = page.locator('li.source', { hasText: mediaFolder })
  await row.getByRole('button', { name: new RegExp('^Remove: ') }).click()
  await page.getByRole('dialog', { name: 'Remove this folder from Theama?' }).getByRole('button', { name: 'Remove folder' }).click()
  await expect(page.getByText('No folders yet.')).toBeVisible()
})

test('renames files from a preview, takes the subtitle along, and can put everything back', async () => {
  for (const f of await readdir(mediaFolder)) await rm(join(mediaFolder, f), { force: true })
  for (const f of ['Interstellar.2014.1080p.BluRay.mkv', 'Interstellar.2014.1080p.BluRay.en.srt']) writeFileSync(join(mediaFolder, f), 'x')
  const here = page.url().split('#')[0]
  await page.goto(here + '#/settings/library')
  await page.getByRole('button', { name: 'Add folder' }).first().click()
  const add = page.getByRole('dialog', { name: 'Add a media folder' })
  await add.getByRole('button', { name: 'Auto-detect' }).click()
  await add.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByText('Folder added', { exact: true })).toBeVisible()

  await nav('Movies').click()
  await page.getByRole('link', { name: /^Interstellar/ }).click()
  await expect(page.getByRole('heading', { name: 'Interstellar', level: 1 })).toBeVisible()

  // The preview changes nothing on disk.
  await page.locator('[data-test="rename-files"]').click()
  const dialog = page.getByRole('dialog', { name: 'Rename files' })
  const rows = dialog.locator('[data-test="rename-rows"] li')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Interstellar.2014.1080p.BluRay.mkv')
  await expect(rows.first()).toContainText('Interstellar (2014).mkv')
  await expect(rows.nth(1)).toContainText('Interstellar (2014).en.srt')
  await expect(rows.nth(1)).toContainText('Subtitle')
  expect(existsSync(join(mediaFolder, 'Interstellar.2014.1080p.BluRay.mkv'))).toBe(true)

  // A template that cannot work is explained, not applied.
  await dialog.locator('[data-test="rename-template"] input').fill('{titel}')
  await dialog.getByRole('button', { name: 'Update preview' }).click()
  await expect(dialog.getByText(/Unknown name \{titel\}/)).toBeVisible()
  await dialog.locator('[data-test="rename-template"] input').fill('{title} [{year}]')
  await dialog.getByRole('button', { name: 'Update preview' }).click()
  await expect(rows.first()).toContainText('Interstellar [2014].mkv')
  await dialog.locator('[data-test="rename-template"] input').fill('{title} ({year})')
  await dialog.getByRole('button', { name: 'Update preview' }).click()
  await expect(rows.first()).toContainText('Interstellar (2014).mkv')

  // Apply: both files are renamed, and the page follows.
  await dialog.locator('[data-test="rename-apply"]').click()
  await expect(dialog.locator('[data-test="rename-result"]')).toContainText('Renamed 2 files.')
  expect(existsSync(join(mediaFolder, 'Interstellar (2014).mkv'))).toBe(true)
  expect(existsSync(join(mediaFolder, 'Interstellar (2014).en.srt'))).toBe(true)
  expect(existsSync(join(mediaFolder, 'Interstellar.2014.1080p.BluRay.mkv'))).toBe(false)

  // Undo: everything back where it was.
  await dialog.locator('[data-test="rename-undo"]').click()
  await expect(dialog.locator('[data-test="rename-result"]')).toContainText('Put 2 files back.')
  expect(existsSync(join(mediaFolder, 'Interstellar.2014.1080p.BluRay.mkv'))).toBe(true)
  expect(existsSync(join(mediaFolder, 'Interstellar.2014.1080p.BluRay.en.srt'))).toBe(true)
  expect(existsSync(join(mediaFolder, 'Interstellar (2014).mkv'))).toBe(false)
  await dialog.getByRole('button', { name: 'Close' }).click()

  // The history remembers it.
  await page.goto(here + '#/settings/files')
  const history = page.locator('[data-test="rename-history"] li').first()
  await expect(history).toContainText('2 renamed')
  await expect(history).toContainText('2 undone')

  // Tidy up so the following tests start from an empty library.
  await page.goto(here + '#/settings/library')
  const row = page.locator('li.source', { hasText: mediaFolder })
  await row.getByRole('button', { name: new RegExp('^Remove: ') }).click()
  await page.getByRole('dialog', { name: 'Remove this folder from Theama?' }).getByRole('button', { name: 'Remove folder' }).click()
  await expect(page.getByText('No folders yet.')).toBeVisible()
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

test('can keep running in the notification area: closing the window hides it, and it comes back', async () => {
  const here = page.url().split('#')[0]
  await page.goto(here + '#/settings/general')
  const toggle = page.locator('[data-test="close-to-tray"] input')
  await expect(toggle).not.toBeChecked()
  // A development build cannot register itself to start with Windows, and says so.
  await expect(page.locator('[data-test="start-with-windows"] input')).toBeDisabled()
  await expect(page.getByText('Only the installed app can start with Windows.')).toBeVisible()

  await toggle.check({ force: true })
  await expect(toggle).toBeChecked()
  const windowState = () => app.evaluate(({ BrowserWindow }) => ({ count: BrowserWindow.getAllWindows().length, visible: BrowserWindow.getAllWindows()[0]?.isVisible() ?? false }))
  expect(await windowState()).toEqual({ count: 1, visible: true })

  // The close button: the window disappears, the app (and the service it manages) keeps running.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect.poll(windowState).toEqual({ count: 1, visible: false })

  // The tray icon's "open", or a second launch of the app, brings it back.
  await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance'))
  await expect.poll(windowState).toEqual({ count: 1, visible: true })

  // Turned off again, closing is closing (not exercised here: it would end the test app).
  await toggle.uncheck({ force: true })
  await expect(toggle).not.toBeChecked()
  await page.goto(here + '#/')
})

test('switches to Greek without a restart and the choice persists to the API', async () => {
  await page.goto(page.url().split('#')[0] + '#/settings/general')
  await expect(page.getByRole('heading', { name: 'General', level: 2 })).toBeVisible()
  await page.waitForTimeout(500) // let the freshly shown page settle: a click in the first instants can be missed
  await page.getByRole('button', { name: 'Ελληνικά' }).click()
  await expect(page.getByRole('heading', { name: 'Ρυθμίσεις', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Κύρια πλοήγηση' }).getByRole('link', { name: 'Ταινίες' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'el')
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Κύρια πλοήγηση' })).toBeVisible({ timeout: 30_000 })
})

test('toggles between dark and light themes', async () => {
  await page.goto(page.url().split('#')[0] + '#/settings/general')
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Ανοιχτό' }).click()
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--theamaLight/)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBackgroundColor())).toBe('#F6F1E7')
  await page.getByRole('button', { name: 'Σκούρο' }).click()
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--theamaDark/)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBackgroundColor())).toBe('#0F0E0C')
})

test('mobile width switches to bottom navigation', async () => {
  await page.setViewportSize({ width: 420, height: 800 })
  await expect(page.locator('.v-bottom-navigation')).toBeVisible()
  await expect(page.locator('.topnav')).toHaveCount(0)
  await expect(page.locator('.appbar')).toBeVisible()
  await expect(page.locator('.v-navigation-drawer')).toHaveCount(0)
})
