import { app, BrowserWindow, dialog, Menu, net, protocol, screen, session, shell } from 'electron'
import { appendFileSync, existsSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC, IndexerStatus, LaunchInfo, type DesktopSettings, type DesktopSettingsPatch, type NextUp, type ServiceActionResult, type ServiceStatus } from '@theama/contracts'
import { defaultDataDir, resolveDataPaths } from '@theama/logs'
import { registerIpc } from './ipc'
import { DownloadToolsManager } from './download-tools'
import { menuStrings } from './menu-strings'
import { originOf } from './origin'
import { launchDetached, PlayerManager } from './players'
import { trackPlayback } from './position-tracking'
import { progressReporter } from './playback-reporting'
import { TrailerView } from './trailer-view'
import { PrefsStore } from './prefs'
import { restoreWindowState } from './window-state'
import { shouldHideOnClose, shouldStartHidden } from './behaviour'
import { TrayIcon } from './tray'
import { logDesktop } from './desktop-log'
import { probeHealth, readConnection, type ApiConnection } from './runtime'
import { resolveAdminPaths } from './service/admin-paths'
import type { ServiceController } from './service/controller'
import { DevProcessController } from './service/dev-controller'
import { createNssmController } from './service/nssm-controller'

const APP_ORIGIN = 'app://theama'
const SERVICE_POLL_MS = 4000

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

const dev = !app.isPackaged
const repoRoot = join(app.getAppPath(), '..', '..')
const devUiUrl = process.env.THEAMA_DEV_URL
const dataDir = process.env.THEAMA_DATA_DIR ?? (dev ? join(repoRoot, '.dev-data') : defaultDataDir())
const paths = resolveDataPaths(dataDir)
const uiDir = normalize(process.env.THEAMA_UI_DIR ?? (dev ? join(repoRoot, 'apps', 'ui', 'dist') : join(process.resourcesPath, 'ui')))
const brandDir = process.env.THEAMA_BRAND_DIR ?? (dev ? join(repoRoot, 'packages', 'brand', 'assets') : process.resourcesPath)
const controllerKind = process.env.THEAMA_CONTROLLER ?? (dev ? 'dev' : 'nssm')

let mainWindow: BrowserWindow | null = null
let controller: ServiceController
let prefs: PrefsStore
let lastStatus: ServiceStatus | null = null
let busy = false

type ServiceMenuAction = 'start' | 'stop' | 'restart' | 'install' | 'repair' | 'uninstall'

const WINDOW_THEME = {
  dark: { background: '#0F0E0C', surface: '#171510', symbols: '#EFE8DA' },
  light: { background: '#F6F1E7', surface: '#FCF9F2', symbols: '#1C1A16' },
} as const

// Cheap cache: the connection is read on every API request header injection.
let cachedConn: { at: number; value: ApiConnection | null } = { at: 0, value: null }
function connection(): ApiConnection | null {
  if (Date.now() - cachedConn.at > 500) cachedConn = { at: Date.now(), value: readConnection(paths) }
  return cachedConn.value
}

/** Development/test only: record what would be started instead of starting a real player (never honoured in a released build). */
const testPlayerLog = dev ? process.env.THEAMA_TEST_PLAYER_LOG : undefined

function testPlayerHost(): { env: NodeJS.ProcessEnv; exists(path: string): boolean } | undefined {
  if (!testPlayerLog) return undefined
  // Pretend the usual players are installed under a made-up Program Files folder.
  const env: NodeJS.ProcessEnv = { ...process.env, ProgramFiles: 'C:\\FAKE-PF', 'ProgramFiles(x86)': '', ProgramW6432: '', PATH: '' }
  return { env, exists: (p) => p.startsWith('C:\\FAKE-PF\\') || existsSync(p) }
}

async function recordLaunch(exe: string, args: string[]): Promise<void> {
  appendFileSync(testPlayerLog!, `${JSON.stringify({ exe, args })}\n`)
}

/** Asks the backend which file to open. The path never comes from the UI: only a file id does. */
async function fetchLaunchInfo(fileId: number) {
  const conn = connection()
  if (!conn) return { ok: false as const, code: 'unreachable' as const, message: 'The Theama service is not running' }
  try {
    const res = await fetch(`${conn.base}/api/v1/playback/files/${fileId}/launch`, { headers: { Authorization: `Bearer ${conn.token}` } })
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `The service answered ${res.status}`
      return { ok: false as const, code: res.status === 404 || res.status === 409 ? ('unavailable' as const) : ('unreachable' as const), message }
    }
    return { ok: true as const, info: LaunchInfo.parse(body) }
  } catch (err) {
    return { ok: false as const, code: 'unreachable' as const, message: err instanceof Error ? err.message : 'The Theama service could not be reached' }
  }
}
const probe = async (c: ApiConnection): Promise<boolean> => (await probeHealth(c)) !== null

function trustedOrigins(): string[] {
  const dev = devUiUrl ? originOf(devUiUrl) : null
  return dev ? [APP_ORIGIN, dev] : [APP_ORIGIN]
}

function createController(): ServiceController {
  if (controllerKind === 'nssm') {
    return createNssmController({
      adminPaths: resolveAdminPaths({
        packaged: app.isPackaged,
        repoRoot,
        resourcesPath: process.resourcesPath,
        dataDir,
        nodeExe: process.env.THEAMA_NODE ?? 'node.exe',
      }),
      connection,
      probe,
    })
  }
  // "process" runs the packaged app's own Node and server as a plain child of the app, with no Windows service. It exists for
  // the packaged smoke test and for a quick look without installing the service; it is not how Theama normally runs.
  const packagedProcess = controllerKind === 'process' && app.isPackaged
  return new DevProcessController({
    serverDir: packagedProcess ? process.resourcesPath : join(repoRoot, 'apps', 'server'),
    ...(packagedProcess
      ? { command: { exe: join(process.resourcesPath, 'node', 'node.exe'), args: [join(process.resourcesPath, 'server', 'server.cjs')] } }
      : {}),
    env: {
      THEAMA_DATA_DIR: dataDir,
      THEAMA_HOST_MODE: 'foreground',
      THEAMA_PORT: process.env.THEAMA_PORT ?? '47890',
      ...(devUiUrl ? { THEAMA_EXTRA_ORIGINS: originOf(devUiUrl) ?? '' } : {}),
    },
    connection,
    probe,
    onOutput: (line) => console.log(`[server] ${line}`),
  })
}

let tray: TrayIcon | null = null
let quitting = false

function desktopSettings(): DesktopSettings {
  return {
    closeToTray: prefs.behaviour.closeToTray,
    // The operating system is the source of truth for sign-in start-up; a development build cannot register itself.
    startWithWindows: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false,
    startWithWindowsSupported: app.isPackaged,
  }
}

/** Puts the tray icon and the sign-in start-up in line with the saved choices. */
function applyBehaviour(): void {
  tray ??= new TrayIcon(brandDir, { open: showWindow, quit: () => app.quit() })
  if (prefs.behaviour.closeToTray) tray.show(prefs.language, lastStatus)
  else tray.hide()
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.behaviour.startWithWindows, args: ['--hidden'] })
}

function setDesktopSettings(patch: DesktopSettingsPatch): DesktopSettings {
  prefs.setBehaviour({
    closeToTray: patch.closeToTray ?? prefs.behaviour.closeToTray,
    startWithWindows: patch.startWithWindows ?? prefs.behaviour.startWithWindows,
  })
  applyBehaviour()
  return desktopSettings()
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** The episode ended: bring Theama forward and let its window run the countdown to the next one. */
function offerNextEpisode(nextUp: NextUp): void {
  const hadWindow = mainWindow !== null
  showWindow()
  const win = mainWindow
  if (!win) return
  const send = (): void => void win.webContents.send(IPC.evNextUp, nextUp)
  if (hadWindow && !win.webContents.isLoading()) send()
  else win.webContents.once('did-finish-load', () => setTimeout(send, 1000))
}

function setWindowTheme(theme: 'dark' | 'light'): void {
  const colors = WINDOW_THEME[theme]
  mainWindow?.setBackgroundColor(colors.background)
  mainWindow?.setTitleBarOverlay({ color: colors.surface, symbolColor: colors.symbols, height: 64 })
}

function publishStatus(status: ServiceStatus): void {
  const changed = JSON.stringify(status) !== JSON.stringify(lastStatus)
  lastStatus = status
  if (changed) {
    mainWindow?.webContents.send(IPC.evServiceStatus, status)
    tray?.refresh(prefs.language, status)
  }
}

async function refreshStatus(): Promise<ServiceStatus> {
  const status = await controller.status()
  publishStatus(status)
  return status
}

/** Runs an action with busy/menu bookkeeping, confirmation for removal, and a dialog on failure. */
async function runServiceAction(
  action: ServiceMenuAction,
  account: 'current-user' | 'local-system' = 'current-user',
): Promise<ServiceActionResult> {
  const s = menuStrings(prefs.language)
  if (busy) return { ok: false, message: 'Another service operation is in progress.', status: lastStatus ?? (await controller.status()) }

  if (action === 'uninstall' && mainWindow) {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: s.confirmUninstallTitle,
      message: s.confirmUninstallTitle,
      detail: s.confirmUninstallBody,
      buttons: [s.confirmUninstall, s.cancel],
      defaultId: 1,
      cancelId: 1,
    })
    if (choice.response !== 0) return { ok: false, message: 'Cancelled', status: lastStatus ?? (await controller.status()) }
  }

  busy = true
  try {
    const accountChoice = { kind: account }
    const result =
      action === 'install'
        ? await controller.install(accountChoice)
        : action === 'repair'
          ? await controller.repair(accountChoice)
          : await controller[action]()
    publishStatus(result.status)
    if (!result.ok && result.message && mainWindow) {
      await dialog.showMessageBox(mainWindow, { type: 'error', title: s.errorTitle, message: result.message })
    }
    return result
  } finally {
    busy = false
  }
}

function registerProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    if (url.host !== 'theama') return new Response('Forbidden', { status: 403 })
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const file = normalize(join(uiDir, rel))
    // Never serve anything outside the UI bundle (path traversal guard).
    if (!file.startsWith(uiDir + sep) || !existsSync(file)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

/**
 * The renderer never sees the API token. The main process adds it to requests
 * for the exact loopback port the backend reports, and to nothing else.
 */
function installAuthHeaderInjection(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1/*', 'ws://127.0.0.1/*'] }, (details, callback) => {
    const conn = connection()
    const headers = { ...details.requestHeaders }
    try {
      if (conn && new URL(details.url).port === String(conn.port)) headers.Authorization = `Bearer ${conn.token}`
    } catch {
      // Unparseable URL: send it untouched, without credentials.
    }
    callback({ requestHeaders: headers })
  })
}

function hardenSession(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (contents.session !== session.defaultSession) return // the trailer view has its own, stricter, guard
      const origin = originOf(url)
      if (origin === null || !trustedOrigins().includes(origin)) event.preventDefault()
    })
  })
}

function createWindow(): void {
  const icon = join(brandDir, dev ? 'theama.ico' : 'icon.ico')
  const saved = restoreWindowState(prefs.window, screen.getAllDisplays().map((d) => d.workArea))
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x === undefined || saved.y === undefined ? {} : { x: saved.x, y: saved.y }),
    minWidth: 480,
    minHeight: 560,
    show: false,
    backgroundColor: '#0F0E0C',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: WINDOW_THEME.dark.surface, symbolColor: WINDOW_THEME.dark.symbols, height: 64 },
    title: 'Theama',
    icon: existsSync(icon) ? icon : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  const startHidden = shouldStartHidden(process.argv, prefs.behaviour.closeToTray, tray?.active === true)
  mainWindow.once('ready-to-show', () => {
    if (saved.maximized) mainWindow?.maximize()
    if (!startHidden) mainWindow?.show()
  })
  // With "keep Theama in the tray" on, closing the window only hides it; Quit (menu or tray) really quits.
  mainWindow.on('close', (event) => {
    if (shouldHideOnClose({ closeToTray: prefs.behaviour.closeToTray, trayShown: tray?.active === true, quitting })) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  // Remember where the window was, a moment after it stops moving (not on every pixel of a drag).
  let saveTimer: NodeJS.Timeout | undefined
  const remember = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const win = mainWindow
      if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
      const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds()
      prefs.setWindow({ ...b, maximized: win.isMaximized() })
    }, 600)
  }
  mainWindow.on('resize', remember)
  mainWindow.on('move', remember)
  mainWindow.on('maximize', remember)
  mainWindow.on('unmaximize', remember)
  mainWindow.on('close', () => {
    clearTimeout(saveTimer)
    const win = mainWindow
    if (win && !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) {
      const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds()
      prefs.setWindow({ ...b, maximized: win.isMaximized() })
    }
  })
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.on('render-process-gone', (_e, details) => logDesktop(paths.logsDir, 'error', 'The window\'s renderer process ended unexpectedly', { reason: details.reason, exitCode: details.exitCode }))
  void mainWindow.loadURL(devUiUrl ?? `${APP_ORIGIN}/index.html`)
}

/** Problems in the shell itself go to the same log history as the service's, so they can be found in one place. */
process.on('uncaughtException', (err) => logDesktop(paths.logsDir, 'fatal', 'Uncaught exception in the desktop app', { err: { message: err.message, stack: err.stack } }))
process.on('unhandledRejection', (reason) => logDesktop(paths.logsDir, 'error', 'Unhandled promise rejection in the desktop app', { reason: String(reason) }))

async function main(): Promise<void> {
  app.setAppUserModelId('app.theama.desktop')
  prefs = new PrefsStore(app.getPath('userData'), app.getLocale())
  controller = createController()

  registerProtocol()
  hardenSession()
  installAuthHeaderInjection()
  const players = new PlayerManager({
    host: testPlayerHost(),
    getPrefs: () => prefs.players,
    setPrefs: (p) => prefs.setPlayers(p),
    launch: testPlayerLog ? recordLaunch : launchDetached,
    openWithSystem: (path) => shell.openPath(path),
    fetchLaunchInfo: fetchLaunchInfo,
    reportLaunched: async (fileId) => {
      const conn = connection()
      if (!conn) return
      await fetch(`${conn.base}/api/v1/playback/files/${fileId}/launched`, { method: 'POST', headers: { Authorization: `Bearer ${conn.token}` } })
    },
    // The end-to-end tests use a pretend player, so they never open a tracking interface.
    track: testPlayerLog
      ? undefined
      : (job) => {
          void trackPlayback(job, progressReporter(connection)).done.then((result) => {
            if (result?.nextUp) offerNextEpisode(result.nextUp)
          })
        },
  })
  const trailer = new TrailerView({
    // Honoured only in unpackaged builds, like the other test hooks.
    testUrl: dev ? process.env.THEAMA_TEST_TRAILER_URL : undefined,
    onEscape: () => {
      trailer.hide()
      mainWindow?.webContents.send(IPC.evTrailerClosed)
    },
  })
  registerIpc({
    downloadTools: new DownloadToolsManager({
      openBrowser: (url) => shell.openExternal(url),
      prowlarrUrl: async () => {
        const conn = connection()
        if (!conn) return null
        const res = await fetch(`${conn.base}/api/v1/downloads/indexer`, {
          headers: { Authorization: `Bearer ${conn.token}` }, signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) throw new Error('Could not read the Prowlarr address')
        const status = IndexerStatus.parse(await res.json())
        return status.url
      },
    }),
    players,
    getWindow: () => mainWindow,
    paths,
    controller,
    connection,
    version: app.getVersion(),
    dev,
    trustedOrigins: trustedOrigins(),
    desktopSettings,
    setDesktopSettings,
    setLanguage: (lang) => {
      prefs.setLanguage(lang)
      tray?.refresh(prefs.language, lastStatus)
    },
    setWindowTheme,
    pickFolderTitle: () => menuStrings(prefs.language).pickFolder,
    // Honoured only in unpackaged builds, so a released app can never be steered by an environment variable.
    testPickFolder: dev ? process.env.THEAMA_TEST_PICK_FOLDER : undefined,
    trailer,
    runService: (action, account) => runServiceAction(action, account),
    currentStatus: refreshStatus,
  })

  // Navigation lives in the themed app header; there is no native File/Edit/etc. strip.
  Menu.setApplicationMenu(null)
  applyBehaviour()
  createWindow()

  // The server is brought up in the background so the window opens immediately.
  void refreshStatus().then(async (status) => {
    if (controllerKind !== 'nssm' && !status.apiReachable) await runServiceAction('start')
  })
  setInterval(() => {
    if (!busy) void refreshStatus().catch(() => undefined)
  }, SERVICE_POLL_MS).unref()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  // Closing the window quits the UI only: the Windows service keeps managing the library.
  app.on('window-all-closed', () => app.quit())

  let disposed = false
  app.on('before-quit', (event) => {
    quitting = true
    if (disposed || !controller?.dispose) return
    event.preventDefault()
    disposed = true
    void controller.dispose().finally(() => app.quit())
  })

  void app.whenReady().then(main)
}
