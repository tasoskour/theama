import { z } from 'zod'
import { ServiceAccountChoice, ServiceStatus } from './service'
import type { UiLanguage } from './settings'
import { LogEntry } from './logs'
import type { NextUp } from './playback'

/**
 * Narrow, typed IPC surface between the sandboxed renderer and the Electron
 * main process. Every request is validated in the main process before acting.
 */
export const IPC = {
  pickFolder: 'dialog:pickFolder',
  pickBackupFile: 'dialog:pickBackup',
  desktopGet: 'desktop:get',
  desktopSet: 'desktop:set',
  windowSetTheme: 'window:setTheme',
  openPath: 'shell:openPath',
  showItemInFolder: 'shell:showItemInFolder',
  openExternal: 'shell:openExternal',
  trailerShow: 'trailer:show',
  trailerBounds: 'trailer:bounds',
  trailerHide: 'trailer:hide',
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
  /** Main to renderer push: the trailer was closed from inside the video (Escape). */
  evTrailerClosed: 'ev:trailer-closed',
  /** Main to renderer push: an episode ended and the next one should start after a countdown. */
  evNextUp: 'ev:next-up',
  /** Main to renderer push: service status changed. */
  evServiceStatus: 'ev:service-status',
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
export const ExternalLinkRequest = z.discriminatedUnion('service', [
  z.object({ service: z.literal('tmdb'), kind: z.enum(['movie', 'series']), id: z.string().regex(/^\d+$/) }),
  z.object({ service: z.literal('imdb'), id: z.string().regex(/^tt\d{5,12}$/) }),
  z.object({ service: z.literal('youtube'), id: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }),
])
export type ExternalLinkRequest = z.infer<typeof ExternalLinkRequest>
/** Where the trailer container's video area is in the window, in CSS pixels (the page measures it). */
export const TrailerBounds = z.object({
  x: z.number().int().min(0).max(20_000),
  y: z.number().int().min(0).max(20_000),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
})
export type TrailerBounds = z.infer<typeof TrailerBounds>
/** A YouTube video id (the shell builds the embed address itself) and where to play it. */
export const TrailerShowRequest = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{11}$/), bounds: TrailerBounds })
export type TrailerShowRequest = z.infer<typeof TrailerShowRequest>
export const ServiceInstallRequest = z.object({ account: ServiceAccountChoice })
export const LocalLogsRequest = z.object({ limit: z.number().int().min(1).max(500).default(200) })

/** How the desktop app behaves around the window; kept by the desktop app itself, per Windows user. */
export const DesktopSettings = z.object({
  /** Closing the window keeps Theama in the notification area instead of quitting. */
  closeToTray: z.boolean(),
  /** Start Theama when the person signs in to Windows (to the tray, if the tray is on). */
  startWithWindows: z.boolean(),
  /** False in a development build: it cannot register itself to start with Windows. */
  startWithWindowsSupported: z.boolean(),
})
export type DesktopSettings = z.infer<typeof DesktopSettings>
export const DesktopSettingsPatch = z.object({ closeToTray: z.boolean().optional(), startWithWindows: z.boolean().optional() })
export type DesktopSettingsPatch = z.infer<typeof DesktopSettingsPatch>
export const WindowThemeRequest = z.object({ theme: z.enum(['dark', 'light']) })
export type WindowTheme = z.infer<typeof WindowThemeRequest>['theme']

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
  /** Whether Theama can see how far this player has got (to resume and to mark episodes watched). */
  tracksPosition: z.boolean(),
})
export type PlayerInfo = z.infer<typeof PlayerInfo>

export const PlayerIdRequest = z.object({ id: z.string().min(1).max(200) })
export const PlayRequest = z.object({
  fileId: z.number().int().positive(),
  playerId: z.string().min(1).max(200).optional(),
  /** Ignore the remembered position and start from the beginning. */
  fromStart: z.boolean().optional(),
})
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
  /** Tells the main process which language to use for native dialogs and tray UI. */
  setLanguage(language: UiLanguage): Promise<void>
  pickFolder(title?: string): Promise<string | null>
  /** A native file picker for a Theama backup (.db). Resolves to the chosen path, or null if cancelled. */
  pickBackupFile(): Promise<string | null>
  desktop: {
    get(): Promise<DesktopSettings>
    set(patch: DesktopSettingsPatch): Promise<DesktopSettings>
  }
  /** Keeps Electron's native window controls in step with the resolved UI theme. */
  setWindowTheme(theme: WindowTheme): Promise<void>
  openPath(path: string): Promise<void>
  showItemInFolder(path: string): Promise<void>
  /** Opens a known metadata/video destination in the default browser. Arbitrary URLs are not accepted. */
  openExternal(request: ExternalLinkRequest): Promise<void>
  trailer: {
    /** Plays a YouTube trailer inside the app, on the given area of the window. */
    show(request: TrailerShowRequest): Promise<void>
    /** The video area moved or was resized. */
    setBounds(bounds: TrailerBounds): Promise<void>
    /** Stops the trailer and removes the video. */
    hide(): Promise<void>
    /** The person closed the trailer from inside the video (Escape). */
    onClosed(listener: () => void): () => void
  }
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
    /** A watched episode ended and the next one is due (only when "play next episode" is on). */
    onNextUp(listener: (nextUp: NextUp) => void): () => void
  }
}
