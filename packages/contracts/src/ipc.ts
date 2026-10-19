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
  onNavigate(listener: (route: string) => void): () => void
}
