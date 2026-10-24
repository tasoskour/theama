import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type CDPSession } from '@playwright/test'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../tools/fake-tmdb/server.mjs'

let app: ElectronApplication
let page: Page
let cdp: CDPSession
let fake: FakeTmdb
let dataDir: string
let profile: string
let base: string
let token: string
let titleKey: string
const errors: string[] = []

const api = (path: string, method = 'GET', body?: object): Promise<Response> =>
  fetch(`${base}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

async function resize(width: number): Promise<void> {
  // Emulate CSS viewports even when the test machine's monitor is smaller than 4K.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: width >= 3840 ? 2160 : 900, deviceScaleFactor: 1, mobile: false })
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
}

async function visit(route: string): Promise<void> {
  await page.goto(`${page.url().split('#')[0]}#${route}`)
  await expect(page.locator('.th-page h1').first()).toBeVisible()
  await page.waitForFunction(() => !document.querySelector('.th-fade-enter-active, .th-fade-leave-active'))
}

async function rootSize(): Promise<number> {
  return page.locator('html').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
}

async function expectNoPageOverflow(): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
}

async function expectMobileNavigationFits(): Promise<void> {
  const bounds = await page.locator('.bottomnav').evaluate((el) => {
    const nav = el.getBoundingClientRect()
    return Array.from(el.querySelectorAll('.v-bottom-navigation__content > .v-btn')).map((button) => {
      const box = button.getBoundingClientRect()
      const label = button.querySelector('.label')!.getBoundingClientRect()
      return box.left >= nav.left && box.right <= nav.right && label.top >= nav.top && label.bottom <= nav.bottom
    })
  })
  expect(bounds).toEqual([true, true, true, true, true, true])
  expect(await page.locator('.appbar').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
}

test.beforeAll(async () => {
  fake = await startFakeTmdb()
  dataDir = mkdtempSync(join(tmpdir(), 'theama-type-data-'))
  profile = mkdtempSync(join(tmpdir(), 'theama-type-profile-'))
  const media = join(dataDir, 'media')
  mkdirSync(media)
  writeFileSync(join(media, 'Interstellar.2014.mkv'), 'x')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>
  Object.assign(env, { THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_CONTROLLER: 'dev', THEAMA_FFPROBE: 'none', THEAMA_TMDB_API_BASE: fake.url, THEAMA_TMDB_IMAGE_BASE: fake.imageUrl })
  app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: join(import.meta.dirname, '..'), env })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  cdp = await page.context().newCDPSession(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 90_000 })
  const { port } = JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port: number }
  base = `http://127.0.0.1:${port}`
  token = readFileSync(join(dataDir, 'secrets', 'api-token'), 'utf8').trim()
  expect((await api('/library/sources', 'POST', { path: media, libraryType: 'movies' })).ok).toBe(true)
  expect((await api('/metadata/credentials', 'PUT', { tmdbApiKey: GOOD_KEY })).ok).toBe(true)
  await expect.poll(async () => {
    const status = await (await api('/metadata/status')).json() as { matched: number; pending: number; state: string }
    return status.matched >= 1 && status.pending === 0 && status.state === 'idle'
  }, { timeout: 60_000 }).toBe(true)
  await expect.poll(async () => {
    const titles = await (await api('/library/titles?limit=100')).json() as { items: { key: string; title: string; externalId: string | null }[] }
    const movie = titles.items.find((item) => item.title === 'Interstellar')
    if (movie) titleKey = movie.key
    return Boolean(movie)
  }, { timeout: 60_000 }).toBe(true)
})

test.afterAll(async () => {
  await cdp?.detach()
  await app?.close()
  await fake?.close()
  for (const path of [dataDir, profile]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-type-(data|profile)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
})

test('responsive baseline grows through desktop sizes and caps at 4K', async () => {
  await api('/settings', 'PUT', { textSize: 'default', language: 'en', theme: 'dark' })
  await visit('/settings/general')
  for (const [width, size] of [[360, 16], [1280, 16], [1920, 18], [2560, 20], [3840, 20], [4096, 20]]) {
    await resize(width!)
    await expect.poll(rootSize).toBe(size)
    await expect(page.locator('[data-test="text-size-preview"]')).toHaveCSS('font-size', `${size}px`)
    await expect(page.locator('[data-test="text-size-select"] .v-field')).toHaveCSS('font-size', `${size}px`)
    await expectNoPageOverflow()
  }
})

test('presets resize immediately, persist after reload, and reset to Default', async () => {
  await resize(4096)
  await visit('/settings/general')
  const selector = page.getByRole('combobox', { name: 'Text size', exact: true })
  // Hold the response so we can assert the preview while the save is still pending.
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/v1/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    await gate
    await route.continue()
  })
  try {
    await page.locator('[data-test="text-size-select"] .v-field').click()
    await page.getByRole('option', { name: 'Extra large (130%)', exact: true }).click()
    await expect.poll(rootSize).toBe(26)
    await expect(selector).toBeDisabled()
  } finally {
    release()
  }
  await expect(selector).toBeEnabled()
  await page.unroute('**/api/v1/settings')
  expect((await (await api('/settings')).json() as { textSize: string }).textSize).toBe('extra-large')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Text size', exact: true })).toBeVisible()
  await expect.poll(rootSize).toBe(26)
  await selector.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('option', { name: 'Default (100%)', exact: true }).click()
  await expect.poll(rootSize).toBe(20)
  await expect(selector).toBeEnabled()
})

test('cached startup sizing is applied before the settings API responds', async () => {
  await resize(4096)
  for (const [cached, expected] of [['extra-large', 26], ['invalid', 20]] as const) {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/api/v1/settings', async (route) => {
      if (route.request().method() === 'GET') await gate
      await route.continue()
    })
    try {
      await page.evaluate((textSize) => localStorage.setItem('theama.prefs', JSON.stringify({ language: 'en', textSize })), cached)
      await page.reload()
      await expect.poll(rootSize).toBe(expected)
    } finally {
      release()
    }
    await expect.poll(rootSize).toBe(20)
    await page.unroute('**/api/v1/settings')
  }
})

interface Box { top: number; bottom: number; left: number; right: number; height: number }

async function box(locator: ReturnType<Page['locator']>): Promise<Box> {
  return locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
  })
}

const controlHeight = (): Promise<number> => page.evaluate(() => {
  const probe = document.createElement('div')
  probe.style.height = 'var(--th-control-h)'
  document.body.append(probe)
  const h = probe.getBoundingClientRect().height
  probe.remove()
  return h
})

test('search and downloads toolbars keep compact controls at every size', async ({ browserName: _browserName }, testInfo) => {
  await api('/settings', 'PUT', { textSize: 'extra-large', language: 'en', theme: 'dark' })
  for (const width of [360, 1280, 2560, 4096]) {
    await resize(width)
    await visit('/search')
    await page.evaluate(() => localStorage.setItem('theama.recentSearches', JSON.stringify(['ted lasso'])))
    await page.reload()
    await expect(page.locator('.th-page h1').first()).toBeVisible()
    await expect(page.locator('.start__head')).toBeVisible()
    const control = await controlHeight()
    const field = await box(page.locator('.search-row .th-search-control').first())
    // The field must never stretch to the height of the genre column.
    expect(field.height).toBeLessThanOrEqual(control * 1.3)
    const select = await box(page.locator('.search-row .genre-filter__select'))
    const toggle = await box(page.locator('.search-row .genre-filter__mode'))
    if (width >= 1280) expect(Math.abs((select.top + select.bottom) / 2 - (toggle.top + toggle.bottom) / 2)).toBeLessThanOrEqual(2)
    await expectNoPageOverflow()
    await page.screenshot({ path: testInfo.outputPath(`search-${width}.png`) })
    // "Clear" sits next to its heading, not at the far edge of the panel.
    const heading = await box(page.locator('.start__head h2'))
    const clear = await box(page.locator('.start__head .v-btn'))
    if (clear.top < heading.bottom) expect(clear.left - heading.right).toBeLessThan(control * 4)

    await visit('/downloads')
    const row = page.locator('.find__row')
    for (const sel of ['.find__kind', '.find__text', '.find__genre .genre-filter__select']) {
      const b = await box(row.locator(sel))
      expect(b.height).toBeLessThanOrEqual(control * 1.4)
    }
    // Chips (when present) must not poke out of their field.
    const chips = await row.locator('.genre-filter__chip').evaluateAll((els) => els.map((el) => {
      const field = el.closest('.v-field')!.getBoundingClientRect()
      const chip = el.getBoundingClientRect()
      return chip.top >= field.top - 1 && chip.bottom <= field.bottom + 1
    }))
    expect(chips.every(Boolean)).toBe(true)
    await expectNoPageOverflow()
    await page.screenshot({ path: testInfo.outputPath(`downloads-${width}.png`) })
  }
  expect(errors).toEqual([])
})

for (const language of ['en', 'el'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    test(`Extra large fits library, detail, settings, and dialogs: ${language}, ${theme}`, async ({ browserName: _browserName }, testInfo) => {
      await api('/settings', 'PUT', { textSize: 'extra-large', language, theme })
      await expect(page.locator('html')).toHaveAttribute('lang', language)
      for (const width of [360, 1280, 1920, 2560, 3840, 4096]) {
        await resize(width)
        for (const route of ['/movies', '/search', '/downloads', '/collections', `/title?key=${encodeURIComponent(titleKey)}`, '/settings/downloads', '/settings/advanced/logs', '/settings/advanced/backup', '/settings/general']) {
          await visit(route)
          if (route.startsWith('/title?')) await expect(page.locator('h1.hero__title')).toHaveText('Interstellar')
          await expectNoPageOverflow()
          if (width === 360) await expectMobileNavigationFits()
        }
        const selector = page.getByRole('combobox', { name: language === 'en' ? 'Text size' : 'Μέγεθος κειμένου', exact: true })
        await selector.focus()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('option', { name: language === 'en' ? 'Extra large (130%)' : 'Πολύ μεγάλο (130%)', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await visit('/collections')
        await page.getByRole('button', { name: language === 'en' ? 'New collection' : 'Νέα συλλογή', exact: true }).first().click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
        await page.keyboard.press('Escape')
        if (width === 4096 || width === 360) {
          await visit('/settings/general')
          await page.evaluate(readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8'))
          const violations = await page.evaluate(async () => {
            const axe = (window as unknown as { axe: { run(ctx: string, options: object): Promise<{ violations: { id: string; help: string }[] }> } }).axe
            return (await axe.run('[data-test="text-size"]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations
          })
          expect(violations).toEqual([])
          await page.screenshot({ path: testInfo.outputPath(`text-${width}.png`) })
        }
      }
      expect(errors).toEqual([])
    })
  }
}
