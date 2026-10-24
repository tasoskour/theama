import { ipcMain, shell, dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync } from 'node:fs'
import { z } from 'zod'
import {
  IPC,
  LocalLogsRequest,
  DesktopSettingsPatch,
  ExternalLinkRequest,
  PathRequest,
  PickFolderRequest,
  PlayerIdRequest,
  PlayRequest,
  ServiceInstallRequest,
  SetLanguageRequest,
  TrailerBounds,
  TrailerShowRequest,
  WindowThemeRequest,
  OpenDownloadToolRequest,
  type AppInfo,
  type DesktopSettings,
  type ServiceActionResult,
  type ServiceStatus,
} from '@theama/contracts'
import { readRecentLocal, type DataPaths } from '@theama/logs'
import { originOf } from './origin'
import { assertSafeUserPath } from './path-safety'
import { externalLinkUrl } from './external-link'
import type { TrailerView } from './trailer-view'
import type { PlayerManager } from './players'
import type { ApiConnection } from './runtime'
import type { ServiceController } from './service/controller'
import type { DownloadToolsManager } from './download-tools'

export interface IpcDeps {
  downloadTools: Pick<DownloadToolsManager, 'status' | 'open'>
  getWindow(): BrowserWindow | null
  paths: DataPaths
  controller: ServiceController
  connection(): ApiConnection | null
  version: string
  dev: boolean
  /** Origins allowed to call IPC (the app:// protocol, plus the Vite dev server in development). */
  trustedOrigins: string[]
  setLanguage(lang: 'en' | 'el'): void
  pickFolderTitle(): string
  /** Development/test only: answer the folder picker with this path instead of opening a native dialog. */
  testPickFolder?: string
  trailer: TrailerView
  /** Runs a service action with UI side effects (busy state, status push, confirmations). */
  runService(action: 'start' | 'stop' | 'restart' | 'install' | 'repair' | 'uninstall', account?: 'current-user' | 'local-system'): Promise<ServiceActionResult>
  currentStatus(): Promise<ServiceStatus>
  players: PlayerManager
  desktopSettings(): DesktopSettings
  setDesktopSettings(patch: DesktopSettingsPatch): DesktopSettings
  setWindowTheme(theme: 'dark' | 'light'): void
}

function isTrusted(event: IpcMainInvokeEvent, trusted: string[]): boolean {
  const url = event.senderFrame?.url
  if (!url) return false
  const origin = originOf(url)
  return origin !== null && trusted.includes(origin)
}

/**
 * Registers the narrow IPC surface. Each handler rejects calls from any frame
 * that is not Theama's own UI, and validates its argument with a Zod schema.
 */
export function registerIpc(deps: IpcDeps): void {
  function handle<S extends z.ZodType, R>(channel: string, schema: S, fn: (arg: z.output<S>) => Promise<R> | R): void {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      if (!isTrusted(event, deps.trustedOrigins)) throw new Error(`Rejected IPC call to ${channel} from an untrusted frame`)
      return fn(schema.parse(raw))
    })
  }
  const none = z.undefined().or(z.null())

  handle(IPC.downloadToolsStatus, none, () => deps.downloadTools.status())
  handle(IPC.downloadToolsOpen, OpenDownloadToolRequest, ({ tool }) => deps.downloadTools.open(tool))

  handle(IPC.appInfo, none, (): AppInfo => {
    const conn = deps.connection()
    return {
      version: deps.version,
      platform: process.platform,
      dev: deps.dev,
      apiBase: conn?.base ?? null,
      wsUrl: conn?.wsUrl ?? null,
    }
  })

  handle(IPC.setLanguage, SetLanguageRequest, ({ language }) => deps.setLanguage(language))

  handle(IPC.pickFolder, PickFolderRequest, async ({ title }) => {
    if (deps.testPickFolder) return deps.testPickFolder
    const win = deps.getWindow()
    const options = { title: title ?? deps.pickFolderTitle(), properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.pickBackupFile, none, async () => {
    const win = deps.getWindow()
    const options = { title: 'Choose a Theama backup', properties: ['openFile' as const], filters: [{ name: 'Theama backup', extensions: ['db'] }] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.openPath, PathRequest, async ({ path }) => {
    const error = await shell.openPath(assertSafeUserPath(path))
    if (error) throw new Error(error)
  })

  handle(IPC.showItemInFolder, PathRequest, ({ path }) => shell.showItemInFolder(assertSafeUserPath(path)))
  handle(IPC.openExternal, ExternalLinkRequest, (link) => shell.openExternal(externalLinkUrl(link)))
  handle(IPC.trailerShow, TrailerShowRequest, ({ id, bounds }) => {
    const win = deps.getWindow()
    if (win) deps.trailer.show(win, id, bounds)
  })
  handle(IPC.trailerBounds, TrailerBounds, (bounds) => deps.trailer.setBounds(bounds))
  handle(IPC.trailerHide, none, () => deps.trailer.hide())

  handle(IPC.desktopGet, none, () => deps.desktopSettings())
  handle(IPC.desktopSet, DesktopSettingsPatch, (patch) => deps.setDesktopSettings(patch))
  handle(IPC.windowSetTheme, WindowThemeRequest, ({ theme }) => deps.setWindowTheme(theme))

  handle(IPC.playersList, none, () => deps.players.list())
  handle(IPC.playersSetDefault, PlayerIdRequest, ({ id }) => deps.players.setDefault(id))
  handle(IPC.playersRemove, PlayerIdRequest, ({ id }) => deps.players.remove(id))
  handle(IPC.playersAddCustom, none, async () => {
    const win = deps.getWindow()
    const options = { title: 'Choose a media player', properties: ['openFile' as const], filters: [{ name: 'Programs', extensions: ['exe'] }] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const exe = result.canceled ? null : (result.filePaths[0] ?? null)
    return exe ? deps.players.addCustom(exe) : null
  })
  handle(IPC.playersPlay, PlayRequest, ({ fileId, playerId, fromStart }) => deps.players.play(fileId, playerId, fromStart))

  handle(IPC.serviceStatus, none, () => deps.currentStatus())
  handle(IPC.serviceStart, none, () => deps.runService('start'))
  handle(IPC.serviceStop, none, () => deps.runService('stop'))
  handle(IPC.serviceRestart, none, () => deps.runService('restart'))
  handle(IPC.serviceUninstall, none, () => deps.runService('uninstall'))
  handle(IPC.serviceInstall, ServiceInstallRequest, ({ account }) => deps.runService('install', account.kind))
  handle(IPC.serviceRepair, ServiceInstallRequest, ({ account }) => deps.runService('repair', account.kind))

  handle(IPC.logsReadLocal, LocalLogsRequest, ({ limit }) => readRecentLocal(deps.paths.logsDir, limit))
  handle(IPC.openLogsFolder, none, async () => {
    mkdirSync(deps.paths.logsDir, { recursive: true })
    await shell.openPath(deps.paths.logsDir)
  })
}
