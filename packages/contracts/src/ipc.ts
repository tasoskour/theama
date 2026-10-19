import { z } from 'zod'
import { ServiceAccountChoice, ServiceStatus } from './service'
import type { UiLanguage } from './settings'
import { LogEntry } from './logs'

/**
 * Narrow, typed IPC surface between the sandboxed renderer and the Electron
 * main process. Every request is validated in the main process before acting.
 */
export const IPC = {
  pickFolder: 'dialog:pickFolder',
  openPath: 'shell:openPath',
  showItemInFolder: 'shell:showItemInFolder',
  appInfo: 'app:info',
  setLanguage: 'app:setLanguage',
  serviceStatus: 'service:status',
  serviceStart: 'service:start',
  serviceStop: 'service:stop',
  serviceRestart: 'service:restart',
  serviceInstall: 'service:install',
  serviceUninstall: 'service:uninstall',
  serviceRepair: 'service:repair',
  logsReadLocal: 'logs:readLocal',
  openLogsFolder: 'logs:openFolder',
  playersList: 'players:list',
  playersSetDefault: 'players:setDefault',
  playersAddCustom: 'players:addCustom',
  playersRemove: 'players:remove',
  playersPlay: 'players:play',
  /** Main to renderer push: service status changed. */
  evServiceStatus: 'ev:service-status',
  /** Main to renderer push: native menu asked to navigate. */
  evNavigate: 'ev:navigate',
} as const

export const AppInfo = z.object({
  version: z.string(),
  platform: z.string(),
  dev: z.boolean(),
  /** Base URL for REST calls. The auth token is injected by the main process. */
  apiBase: z.string().nullable(),
  wsUrl: z.string().nullable(),
})
export type AppInfo = z.infer<typeof AppInfo>

export const SetLanguageRequest = z.object({ language: z.enum(['en', 'el']) })
export const PickFolderRequest = z.object({ title: z.string().max(200).optional() })
export const PathRequest = z.object({ path: z.string().min(1).max(32_000) })
export const ServiceInstallRequest = z.object({ account: ServiceAccountChoice })
export const LocalLogsRequest = z.object({ limit: z.number().int().min(1).max(500).default(200) })

export const PlayerKind = z.enum(['vlc', 'mpv', 'mpc-hc', 'mpc-be', 'potplayer', 'system', 'custom'])
export type PlayerKind = z.infer<typeof PlayerKind>

export const PlayerInfo = z.object({
  id: z.string(),
  name: z.string(),
  kind: PlayerKind,
  /** Found on this PC (always true for the system default and for custom players that still exist). */
  available: z.boolean(),
  exe: z.string().nullable(),
  isDefault: z.boolean(),
  /** Only players the person added can be removed. */
  removable: z.boolean(),
  /** Whether Theama can start it with a chosen external subtitle file. */
  externalSubtitle: z.boolean(),
})
export type PlayerInfo = z.infer<typeof PlayerInfo>

export const PlayerIdRequest = z.object({ id: z.string().min(1).max(200) })
export const PlayRequest = z.object({ fileId: z.number().int().positive(), playerId: z.string().min(1).max(200).optional() })
export type PlayRequest = z.infer<typeof PlayRequest>

export const PlayResult = z.object({
  ok: z.boolean(),
  /** A short reason when `ok` is false: file missing, drive offline, player not found. */
  code: z.enum(['unavailable', 'no_player', 'launch_failed', 'unreachable']).nullable(),
  message: z.string().nullable(),
  playerName: z.string().nullable(),
})
export type PlayResult = z.infer<typeof PlayResult>

export const ServiceActionResult = z.object({
  ok: z.boolean(),
  message: z.string().nullable(),
  status: ServiceStatus,
})
export type ServiceActionResult = z.infer<typeof ServiceActionResult>

/** The object exposed to the renderer as window.theama. */
export interface TheamaBridge {
  appInfo(): Promise<AppInfo>
  /** Tells the main process which language to use for native menus and dialogs. */
  setLanguage(language: UiLanguage): Promise<void>
  pickFolder(title?: string): Promise<string | null>
  openPath(path: string): Promise<void>
  showItemInFolder(path: string): Promise<void>
  service: {
    status(): Promise<ServiceStatus>
    start(): Promise<ServiceActionResult>
    stop(): Promise<ServiceActionResult>
    restart(): Promise<ServiceActionResult>
    install(account: ServiceAccountChoice): Promise<ServiceActionResult>
    uninstall(): Promise<ServiceActionResult>
    repair(account: ServiceAccountChoice): Promise<ServiceActionResult>
    onStatus(listener: (status: ServiceStatus) => void): () => void
  }
  logs: {
    readLocal(limit?: number): Promise<LogEntry[]>
    openFolder(): Promise<void>
  }
  /** Players are started by the desktop shell, which asks the backend which file to open; the UI never supplies a path. */
  players: {
    list(): Promise<PlayerInfo[]>
    setDefault(id: string): Promise<PlayerInfo[]>
    /** Opens a file picker for an executable. Resolves to the updated list, or null if cancelled. */
    addCustom(): Promise<PlayerInfo[] | null>
    remove(id: string): Promise<PlayerInfo[]>
    play(request: PlayRequest): Promise<PlayResult>
  }
  onNavigate(listener: (route: string) => void): () => void
}
