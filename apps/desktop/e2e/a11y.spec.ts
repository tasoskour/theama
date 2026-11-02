import { dismissInitialSetup } from './setup-helper'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../tools/fake-tmdb/server.mjs'

/**
 * Automated accessibility audit (axe-core, WCAG 2.0/2.1 A and AA) of every page and dialog, with real content
 * in the library, in both themes and both languages. It cannot replace a pass with a screen reader, but it
 * catches the mistakes machines can see: missing names and labels, bad roles and landmarks, poor contrast.
 */
let app: ElectronApplication
let page: Page
let fake: FakeTmdb
let dataDir: string
let userData: string
let media: string
let personal: string
let base: string
let token: string

const api = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${base}/api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })

test.beforeAll(async () => {
  fake = await startFakeTmdb()
  dataDir = mkdtempSync(join(tmpdir(), 'theama-a11y-data-'))
  userData = mkdtempSync(join(tmpdir(), 'theama-a11y-profile-'))
  media = mkdtempSync(join(tmpdir(), 'theama-a11y-media-'))
  personal = mkdtempSync(join(tmpdir(), 'theama-a11y-personal-'))
  for (const f of ['Interstellar.2014.mkv', 'Mad.Max.1979.mkv', 'Mad.Max.Fury.Road.2015.mkv', 'Severance.S01E01.mkv', 'Severance.S01E03.mkv', 'Doctor.Who.S01E01.mkv', 'Zxqv.Wplm.2003.mkv']) {
    writeFileSync(join(media, f), 'x')
  }
  mkdirSync(join(personal, 'Family'))
  writeFileSync(join(personal, 'Family', 'Trip to Crete.mp4'), 'x')
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  Object.assign(env, {
    THEAMA_DATA_DIR: dataDir,
    THEAMA_PORT: '0',
    THEAMA_CONTROLLER: 'dev',
    THEAMA_FFPROBE: 'none',
    THEAMA_TMDB_API_BASE: fake.url,
    THEAMA_TMDB_IMAGE_BASE: fake.imageUrl,
    THEAMA_TEST_PLAYER_LOG: join(dataDir, 'players.log'),
  })
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: join(import.meta.dirname, '..'), env })
  page = await app.firstWindow()
  await dismissInitialSetup(page)
  await page.emulateMedia({ reducedMotion: 'reduce' }) // no half-finished fades while the audit looks at colours
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1360, 2400)) // tall: as little as possible below the fold
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 90_000 })

  const port = (JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port: number }).port
  base = `http://127.0.0.1:${port}`
  token = readFileSync(join(dataDir, 'secrets', 'api-token'), 'utf8').trim()
  await api('/library/sources', { method: 'POST', body: JSON.stringify({ path: media, libraryType: 'auto' }) })
  await api('/library/sources', { method: 'POST', body: JSON.stringify({ path: personal, libraryType: 'videos' }) })
  await api('/metadata/credentials', { method: 'PUT', body: JSON.stringify({ tmdbApiKey: GOOD_KEY }) })
  await expect
    .poll(async () => {
      const s = (await (await api('/metadata/status')).json()) as { pending: number; state: string; matched: number }
      const scanning = ((await (await api('/library/status')).json()) as { scanning: boolean }).scanning
      return !scanning && s.pending === 0 && s.state === 'idle' && s.matched >= 3
    }, { timeout: 60_000 })
    .toBe(true)
  const titles = (await (await api('/library/titles?limit=100')).json()) as { items: { title: string; key: string }[] }
  const key = titles.items.find((t) => t.title === 'Interstellar')!.key
  await api('/collections', { method: 'POST', body: JSON.stringify({ name: 'Weekend picks', key }) })
})

test.afterAll(async () => {
  await app.close()
  await fake.close()
  rmSync(dataDir, { recursive: true, force: true })
  await rm(userData, { recursive: true, force: true }).catch(() => undefined)
  await rm(media, { recursive: true, force: true }).catch(() => undefined)
  await rm(personal, { recursive: true, force: true }).catch(() => undefined)
})

const here = (): string => page.url().split('#')[0]!

async function go(route: string, ready: () => Promise<unknown>): Promise<void> {
  await page.goto(`${here()}#${route}`)
  await page.waitForTimeout(400) // the old page leaves before the new one is shown
  await ready()
  await page.waitForTimeout(250)
}

/** axe-core is injected straight into the page: @axe-core/playwright opens a second page, which Electron cannot do. */
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8')
interface AxeViolation {
  id: string
  impact?: string
  help: string
  nodes: { target: string[]; any: { message: string }[] }[]
}

/** Waits until no page is fading in or out: an audit of a half-faded page sees two pages and washed-out colours. */
async function settled(): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('.th-fade-enter-active, .th-fade-leave-active, .th-fade-enter-from, .th-fade-leave-to'), undefined, { timeout: 10_000 })
  await page.waitForTimeout(150)
}

async function violations(label: string): Promise<string[]> {
  await settled()
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource)
  const found = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(ctx: Document, options: object): Promise<{ violations: { id: string; impact?: string; help: string; nodes: { target: string[]; html: string; any: { message: string; data?: { bgColor?: string } }[] }[] }[] }> } }).axe
    const result = (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations

    // axe cannot see the colour behind something that is below the fold or skipped by content-visibility, and then
    // assumes white. Work the contrast out again from the real background (the nearest opaque ancestor) and only
    // keep the finding if it still fails.
    const parse = (css: string): number[] | null => {
      const m = css.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const [r, g, b, a = 1] = m[1]!.split(',').map((x) => parseFloat(x))
      return a === 0 ? null : [r!, g!, b!]
    }
    const lum = ([r, g, b]: number[]): number => {
      const f = (v: number): number => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
    }
    const realContrast = (el: Element): number | null => {
      const fg = parse(getComputedStyle(el).color)
      let bg: number[] | null = null
      for (let p: Element | null = el; p && !bg; p = p.parentElement) bg = parse(getComputedStyle(p).backgroundColor)
      if (!fg || !bg) return null
      const [a, b] = [lum(fg), lum(bg)]
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    return result
      .map((v) => ({
        ...v,
        nodes: v.nodes.filter((n) => {
          if (v.id !== 'color-contrast' || !n.any.some((c) => /background color: #ffffff/i.test(c.message))) return true
          const el = document.querySelector(n.target.join(' '))
          const ratio = el ? realContrast(el) : null
          return ratio === null || ratio < 4.5
        }),
      }))
      .filter((v) => v.nodes.length > 0)
  })
  const where = (n: AxeViolation['nodes'][number]): string => n.target.join(' ') + (n.any[0]?.message ? `  <- ${n.any[0].message}` : '')
  return (found as AxeViolation[]).map((v) => [`[${label}] ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`, ...v.nodes.slice(0, 3).map((n) => `      ${where(n)}`)].join('\n'))
}

const heading = (name: string | RegExp, level = 1) => page.getByRole('heading', { name, level }).first()

/** Every page and dialog of the app. `ready` waits for something that proves the page has its content. */
function pages(lang: 'en' | 'el') {
  const en = lang === 'en'
  return [
    { name: 'home', route: '/', ready: () => expect(page.locator('[data-test="metadata-nudge"], .rail').first()).toBeVisible() },
    { name: 'movies', route: '/movies', ready: () => expect(page.getByRole('link', { name: /Interstellar/ }).first()).toBeVisible() },
    { name: 'series', route: '/series', ready: () => expect(page.getByRole('link', { name: /Severance/ }).first()).toBeVisible() },
    { name: 'my videos', route: '/videos', ready: () => expect(page.getByRole('link', { name: /Trip to Crete/ }).first()).toBeVisible() },
    { name: 'search', route: '/search', ready: () => expect(page.getByRole('textbox')).toBeVisible() },
    { name: 'collections', route: '/collections', ready: () => expect(page.getByRole('link', { name: /Weekend picks/ }).first()).toBeVisible() },
    { name: 'settings: general', route: '/settings/general', ready: () => expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible() },
    { name: 'settings: setup guide', route: '/settings/setup', ready: () => expect(page.locator('#guide-welcome')).toBeVisible() },
    { name: 'settings: library', route: '/settings/library', ready: () => expect(page.locator('li.source').first()).toBeVisible() },
    { name: 'settings: metadata', route: '/settings/metadata', ready: () => expect(page.locator('[data-test="metadata-counts"]')).toBeVisible() },
    { name: 'settings: playback', route: '/settings/playback', ready: () => expect(page.locator('[data-test="player-row"]').first()).toBeVisible() },
    { name: 'settings: files', route: '/settings/files', ready: () => expect(page.locator('[data-test="movie-template"]')).toBeVisible() },
    { name: 'settings: service', route: '/settings/advanced/service', ready: () => expect(page.getByRole('tab').first()).toBeVisible() },
    { name: 'settings: logs', route: '/settings/advanced/logs', ready: () => expect(page.getByRole('textbox', { name: en ? 'Search messages' : /./ }).first()).toBeVisible() },
    { name: 'settings: backup', route: '/settings/advanced/backup', ready: () => expect(page.locator('[data-test="backup-now"]')).toBeVisible() },
    { name: 'settings: about', route: '/settings/advanced/about', ready: () => expect(page.locator('[data-test="copy-report"]')).toBeVisible() },
  ]
}

async function openTitle(card: RegExp, route: string): Promise<void> {
  await go(route, () => expect(page.getByRole('link', { name: card })).toBeVisible())
  await page.getByRole('link', { name: card }).first().click()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  await page.waitForTimeout(300)
}

async function sweep(label: string): Promise<string[]> {
  const found: string[] = []
  const lang = label.includes('el') ? 'el' : 'en'
  for (const p of pages(lang)) {
    await go(p.route, p.ready)
    found.push(...(await violations(`${label} / ${p.name}`)))
  }

  // Title pages: a film, a series with gaps, an unidentified one, a personal video; and a collection.
  for (const [name, card, route] of [
    ['film', /Interstellar/, '/movies'],
    ['series', /Severance/, '/series'],
    ['not identified', /Doctor Who/, '/series'],
    ['personal video', /Trip to Crete/, '/videos'],
  ] as const) {
    await openTitle(card, route)
    found.push(...(await violations(`${label} / title: ${name}`)))
  }
  await go('/collections', () => expect(page.getByRole('link', { name: /Weekend picks/ }).first()).toBeVisible())
  await page.getByRole('link', { name: /Weekend picks/ }).first().click()
  await expect(heading(/Weekend picks/)).toBeVisible()
  await page.waitForTimeout(300)
  found.push(...(await violations(`${label} / collection (mine)`)))
  await go('/collections', () => expect(page.getByRole('link', { name: /Mad Max/ }).first()).toBeVisible())
  await page.getByRole('link', { name: /Mad Max/ }).first().click()
  await expect(heading(/Mad Max/)).toBeVisible()
  await page.waitForTimeout(300)
  found.push(...(await violations(`${label} / collection (official)`)))
  return found
}

async function dialogs(label: string): Promise<string[]> {
  const found: string[] = []
  const audit = async (name: string): Promise<void> => {
    await page.waitForTimeout(350)
    found.push(...(await violations(`${label} / dialog: ${name}`)))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
  await go('/settings/library', () => expect(page.locator('li.source').first()).toBeVisible())
  await page.locator('button', { hasText: /Add folder|Προσθήκη φακέλου/ }).first().click()
  await audit('add folder')

  await openTitle(/Doctor Who/, '/series')
  await page.getByRole('button', { name: /Choose|Επιλογή/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(600)
  await audit('identify')

  await openTitle(/Interstellar/, '/movies')
  await page.locator('[data-test="rename-files"]').click()
  await expect(page.locator('[data-test="rename-rows"]')).toBeVisible()
  await audit('rename')

  await page.locator('[data-test="add-to-collection"]').click()
  await page.locator('[data-test="new-collection"]').click()
  await audit('new collection')
  return found
}

async function setLook(theme: 'dark' | 'light', language: 'en' | 'el'): Promise<void> {
  await api('/settings', { method: 'PUT', body: JSON.stringify({ theme, language }) })
  await expect(page.locator('.v-application')).toHaveClass(theme === 'dark' ? /v-theme--theamaDark/ : /v-theme--theamaLight/)
  await expect(page.locator('html')).toHaveAttribute('lang', language)
  // Start every pass from a page drawn from scratch in this theme, not one repainted from another.
  await page.reload()
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.v-application')).toHaveClass(theme === 'dark' ? /v-theme--theamaDark/ : /v-theme--theamaLight/)
  await page.waitForTimeout(800) // colours settle after the page is drawn
}

for (const [theme, language] of [['dark', 'en'], ['light', 'en'], ['dark', 'el'], ['light', 'el']] as const) {
  test(`accessibility audit: ${theme} theme, ${language === 'en' ? 'English' : 'Greek'}`, async () => {
    test.setTimeout(300_000)
    await setLook(theme, language)
    const label = `${theme} ${language}`
    const found = [...(await sweep(label)), ...(await dialogs(label))]
    // Several instances of the same problem are listed once per page; the summary is what to fix.
    expect(found.join('\n'), `${found.length} kinds of problems found`).toBe('')
  })
}

test('collection cards can be walked with the arrow keys', async () => {
  await setLook('dark', 'en')
  await go('/collections', () => expect(page.getByRole('link', { name: /Weekend picks/ }).first()).toBeVisible())
  const cards = page.locator('[data-collection-id]')
  await expect(cards).toHaveCount(2)
  await cards.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(cards.nth(1)).toBeFocused()
})

test('switching theme live repaints everything, the sidebar included', async () => {
  await setLook('light', 'en')
  await go('/settings/general', () => expect(page.getByRole('button', { name: 'Dark' })).toBeVisible())
  const sidebarText = () => page.evaluate(() => getComputedStyle(document.querySelector('.brand__name')!).color)
  const luminance = (rgb: string): number => {
    const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).map(Number) as [number, number, number]
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }
  expect(luminance(await sidebarText())).toBeLessThan(0.3) // dark text on the light theme
  await page.getByRole('button', { name: 'Dark' }).click()
  await expect.poll(async () => luminance(await sidebarText()), { timeout: 10_000, intervals: [50] }).toBeGreaterThan(0.6) // light text on the dark theme
  await page.getByRole('button', { name: 'Light' }).click()
  await expect.poll(async () => luminance(await sidebarText()), { timeout: 10_000, intervals: [50] }).toBeLessThan(0.3)
})
