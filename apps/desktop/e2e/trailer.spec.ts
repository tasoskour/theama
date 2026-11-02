import { dismissInitialSetup } from './setup-helper'
import type { TheamaBridge } from '@theama/contracts'
import type { WebContentsView } from 'electron'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page
let dataDir: string
let userData: string

const videoId = 'zSWdZVtXT7E'
const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
const fakePlayer = `
  <title>Embedding disabled</title>
  <p>Playback on other websites has been disabled by the video owner</p>
  <a id="popup" target="_blank" href="${watchUrl}&amp;feature=emb_err_woyt">Watch on YouTube</a>
  <a id="navigate" href="${watchUrl}">Watch in the same window</a>
  <a id="untrusted" target="_blank" href="https://youtube.com.evil.example/watch?v=${videoId}">Untrusted popup</a>
  <a id="protocol" target="_blank" href="file:///C:/Windows/notepad.exe">Unsafe protocol</a>
  <button id="fullscreen" onclick="document.documentElement.requestFullscreen()">Full screen</button>
  <button id="exit-fullscreen" onclick="document.exitFullscreen()">Exit full screen</button>
`

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'theama-trailer-data-'))
  userData = mkdtempSync(join(tmpdir(), 'theama-trailer-profile-'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    THEAMA_DATA_DIR: dataDir,
    THEAMA_PORT: '0',
    THEAMA_CONTROLLER: 'dev',
    THEAMA_FFPROBE: 'none',
    THEAMA_TEST_TRAILER_URL: `data:text/html,${encodeURIComponent(fakePlayer)}`,
  }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(import.meta.dirname, '..'),
    env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string>,
  })
  page = await app.firstWindow()
  await dismissInitialSetup(page)
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    Object.assign(globalThis, { trailerExternalLinks: opened })
    shell.openExternal = async (url) => { opened.push(url) }
  })
})

test.afterAll(async () => {
  await app?.close()
  for (const path of [dataDir, userData]) {
    if (!path) continue
    const child = relative(tmpdir(), path)
    if (isAbsolute(child) || !/^theama-trailer-(data|profile)-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
  }
})

test('Watch on YouTube opens the browser from the embedded player without creating an app window', async () => {
  await page.evaluate(async (id) => {
    await (window as unknown as { theama: TheamaBridge }).theama.trailer.show({ id, bounds: { x: 100, y: 100, width: 640, height: 360 } })
  }, videoId)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents.getTitle(),
  )).toBe('Embedding disabled')

  const openedLinks = () => app.evaluate(() =>
    (globalThis as unknown as { trailerExternalLinks: string[] }).trailerExternalLinks,
  )
  const click = (id: string) => app.evaluate(async ({ BrowserWindow }, elementId) => {
    const wc = (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents
    await wc.executeJavaScript(`document.getElementById(${JSON.stringify(elementId)}).click()`, true)
  }, id)

  await click('popup')
  await expect.poll(openedLinks).toEqual([watchUrl])
  await click('navigate')
  await expect.poll(openedLinks).toEqual([watchUrl, watchUrl])

  await click('untrusted')
  await click('protocol')
  // Flush the popup requests before checking that neither reached the system shell.
  await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents
    await wc.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))')
  })
  expect(await openedLinks()).toEqual([watchUrl, watchUrl])
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  expect(await app.evaluate(({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents.getTitle(),
  )).toBe('Embedding disabled')
  await page.evaluate(() => (window as unknown as { theama: TheamaBridge }).theama.trailer.hide())
})

test('the player fills the screen and Escape restores the trailer before closing it', async () => {
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)
  const bounds = { x: 100, y: 100, width: 640, height: 360 }
  await page.evaluate(async ({ id, bounds }) => {
    await (window as unknown as { theama: TheamaBridge }).theama.trailer.show({ id, bounds })
  }, { id: videoId, bounds })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents.getTitle(),
  )).toBe('Embedding disabled')
  const state = () => app.evaluate(({ BrowserWindow }) => {
    const host = BrowserWindow.getAllWindows()[0]!
    const view = host.contentView.children.at(-1)! as WebContentsView
    const { width, height } = host.getContentBounds()
    return { fullscreen: host.isFullScreen(), bounds: view.getBounds(), screen: { x: 0, y: 0, width, height } }
  })
  const fullscreen = () => app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents
    await wc.executeJavaScript('document.getElementById("fullscreen").click()', true)
  })
  const escape = () => app.evaluate(({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  })

  await fullscreen()
  await expect.poll(async () => {
    const s = await state()
    return s.fullscreen && JSON.stringify(s.bounds) === JSON.stringify(s.screen)
  }).toBe(true)
  // Dialog measurements may still arrive while the app is fullscreen.
  const updatedBounds = { x: 120, y: 120, width: 600, height: 338 }
  await page.evaluate((bounds) => (window as unknown as { theama: TheamaBridge }).theama.trailer.setBounds(bounds), updatedBounds)
  const full = await state()
  expect(full.bounds).toEqual(full.screen)

  await escape()
  await expect.poll(async () => (await state()).fullscreen).toBe(false)
  expect((await state()).bounds).toEqual(updatedBounds)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(before + 1)

  await fullscreen()
  await expect.poll(async () => (await state()).fullscreen).toBe(true)
  await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents
    await wc.executeJavaScript('document.getElementById("exit-fullscreen").click()', true)
  })
  await expect.poll(async () => (await state()).fullscreen).toBe(false)
  expect((await state()).bounds).toEqual(updatedBounds)

  await escape()
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(before)
  await page.evaluate(async ({ id, bounds }) => {
    await (window as unknown as { theama: TheamaBridge }).theama.trailer.show({ id, bounds })
  }, { id: videoId, bounds })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents.getTitle(),
  )).toBe('Embedding disabled')
  await fullscreen()
  await expect.poll(async () => (await state()).fullscreen).toBe(true)
  await page.evaluate(() => (window as unknown as { theama: TheamaBridge }).theama.trailer.hide())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(false)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(before)
})

test('closing a fullscreen player preserves an app window that was already fullscreen', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setFullScreen(true))
  await page.evaluate(async (id) => {
    await (window as unknown as { theama: TheamaBridge }).theama.trailer.show({ id, bounds: { x: 100, y: 100, width: 640, height: 360 } })
  }, videoId)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents.getTitle(),
  )).toBe('Embedding disabled')
  await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0]!.contentView.children.at(-1)! as WebContentsView).webContents
    await wc.executeJavaScript('document.documentElement.requestFullscreen()', true)
  })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const host = BrowserWindow.getAllWindows()[0]!
    const view = host.contentView.children.at(-1)! as WebContentsView
    return view.getBounds().width === host.getContentBounds().width
  })).toBe(true)
  await page.evaluate(() => (window as unknown as { theama: TheamaBridge }).theama.trailer.hide())
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setFullScreen(false))
})
