import { app, BrowserWindow, dialog, Menu, net, protocol, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC, type ServiceActionResult, type ServiceStatus } from '@theama/contracts'
import { defaultDataDir, resolveDataPaths } from '@theama/logs'
import { registerIpc } from './ipc'
import { buildMenu, type ServiceMenuAction } from './menu'
import { menuStrings } from './menu-strings'
import { originOf } from './origin'
import { PrefsStore } from './prefs'
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

// Cheap cache: the connection is read on every API request header injection.
let cachedConn: { at: number; value: ApiConnection | null } = { at: 0, value: null }
function connection(): ApiConnection | null {
  if (Date.now() - cachedConn.at > 500) cachedConn = { at: Date.now(), value: readConnection(paths) }
  return cachedConn.value
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
  return new DevProcessController({
    serverDir: join(repoRoot, 'apps', 'server'),
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

function rebuildMenu(): void {
  const menu = buildMenu(
    { language: prefs.language, status: lastStatus, dev, busy },
    {
      navigate: (route) => mainWindow?.webContents.send(IPC.evNavigate, route),
      back: () => mainWindow?.webContents.navigationHistory.goBack(),
      service: (action) => void runServiceAction(action),
      openLogsFolder: () => void shell.openPath(paths.logsDir),
      quit: () => app.quit(),
    },
  )
  Menu.setApplicationMenu(menu)
}

function publishStatus(status: ServiceStatus): void {
  const changed = JSON.stringify(status) !== JSON.stringify(lastStatus)
  lastStatus = status
  if (changed) {
    mainWindow?.webContents.send(IPC.evServiceStatus, status)
    rebuildMenu()
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
  rebuildMenu()
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
    rebuildMenu()
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
      const origin = originOf(url)
      if (origin === null || !trustedOrigins().includes(origin)) event.preventDefault()
    })
  })
}

function createWindow(): void {
  const icon = join(brandDir, dev ? 'theama.ico' : 'icon.ico')
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 480,
    minHeight: 560,
    show: false,
    backgroundColor: '#0F0E0C',
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
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  void mainWindow.loadURL(devUiUrl ?? `${APP_ORIGIN}/index.html`)
}

async function main(): Promise<void> {
  app.setAppUserModelId('app.theama.desktop')
  prefs = new PrefsStore(app.getPath('userData'), app.getLocale())
  controller = createController()

  registerProtocol()
  hardenSession()
  installAuthHeaderInjection()
  registerIpc({
    getWindow: () => mainWindow,
    paths,
    controller,
    connection,
    version: app.getVersion(),
    dev,
    trustedOrigins: trustedOrigins(),
    setLanguage: (lang) => {
      prefs.setLanguage(lang)
      rebuildMenu()
    },
    pickFolderTitle: () => menuStrings(prefs.language).pickFolder,
    // Honoured only in unpackaged builds, so a released app can never be steered by an environment variable.
    testPickFolder: dev ? process.env.THEAMA_TEST_PICK_FOLDER : undefined,
    runService: (action, account) => runServiceAction(action, account),
    currentStatus: refreshStatus,
  })

  rebuildMenu()
  createWindow()

  // The server is brought up in the background so the window opens immediately.
  void refreshStatus().then(async (status) => {
    if (controllerKind === 'dev' && !status.apiReachable) await runServiceAction('start')
  })
  setInterval(() => {
    if (!busy) void refreshStatus().catch(() => undefined)
  }, SERVICE_POLL_MS).unref()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  // Closing the window quits the UI only: the Windows service keeps managing the library.
  app.on('window-all-closed', () => app.quit())

  let disposed = false
  app.on('before-quit', (event) => {
    if (disposed || !controller?.dispose) return
    event.preventDefault()
    disposed = true
    void controller.dispose().finally(() => app.quit())
  })

  void app.whenReady().then(main)
}
