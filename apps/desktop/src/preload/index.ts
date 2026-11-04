import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type LogEntry, type NextUpOffer, type ServiceStatus, type TheamaBridge, type UpdateState } from '@theama/contracts'

// The renderer is sandboxed with no Node access. This is its only door to the
// system, and every call is validated again in the main process.
const bridge: TheamaBridge = {
  downloadTools: {
    status: () => ipcRenderer.invoke(IPC.downloadToolsStatus),
    open: (tool) => ipcRenderer.invoke(IPC.downloadToolsOpen, { tool }),
    detect: () => ipcRenderer.invoke(IPC.downloadToolsDetect),
  },
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  setLanguage: (language) => ipcRenderer.invoke(IPC.setLanguage, { language }),
  pickFolder: (title) => ipcRenderer.invoke(IPC.pickFolder, { title }),
  pickBackupFile: () => ipcRenderer.invoke(IPC.pickBackupFile),
  desktop: {
    get: () => ipcRenderer.invoke(IPC.desktopGet),
    set: (patch) => ipcRenderer.invoke(IPC.desktopSet, patch),
  },
  setWindowTheme: (theme) => ipcRenderer.invoke(IPC.windowSetTheme, { theme }),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, { path }),
  showItemInFolder: (path) => ipcRenderer.invoke(IPC.showItemInFolder, { path }),
  openExternal: (request) => ipcRenderer.invoke(IPC.openExternal, request),
  trailer: {
    show: (request) => ipcRenderer.invoke(IPC.trailerShow, request),
    setBounds: (bounds) => ipcRenderer.invoke(IPC.trailerBounds, bounds),
    hide: () => ipcRenderer.invoke(IPC.trailerHide),
    onClosed: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC.evTrailerClosed, handler)
      return () => ipcRenderer.removeListener(IPC.evTrailerClosed, handler)
    },
  },
  service: {
    status: () => ipcRenderer.invoke(IPC.serviceStatus),
    start: () => ipcRenderer.invoke(IPC.serviceStart),
    stop: () => ipcRenderer.invoke(IPC.serviceStop),
    restart: () => ipcRenderer.invoke(IPC.serviceRestart),
    install: (account) => ipcRenderer.invoke(IPC.serviceInstall, { account }),
    uninstall: () => ipcRenderer.invoke(IPC.serviceUninstall),
    repair: (account) => ipcRenderer.invoke(IPC.serviceRepair, { account }),
    onStatus: (listener) => {
      const handler = (_e: unknown, status: ServiceStatus) => listener(status)
      ipcRenderer.on(IPC.evServiceStatus, handler)
      return () => ipcRenderer.off(IPC.evServiceStatus, handler)
    },
  },
  logs: {
    readLocal: (limit) => ipcRenderer.invoke(IPC.logsReadLocal, { limit: limit ?? 200 }) as Promise<LogEntry[]>,
    openFolder: () => ipcRenderer.invoke(IPC.openLogsFolder),
  },
  updates: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    onState: (listener) => {
      const handler = (_e: unknown, state: UpdateState): void => listener(state)
      ipcRenderer.on(IPC.evUpdateState, handler)
      return () => ipcRenderer.off(IPC.evUpdateState, handler)
    },
  },
  players: {
    list: () => ipcRenderer.invoke(IPC.playersList),
    setDefault: (id) => ipcRenderer.invoke(IPC.playersSetDefault, { id }),
    addCustom: () => ipcRenderer.invoke(IPC.playersAddCustom),
    remove: (id) => ipcRenderer.invoke(IPC.playersRemove, { id }),
    play: (request) => ipcRenderer.invoke(IPC.playersPlay, request),
    playNext: (offerId) => ipcRenderer.invoke(IPC.playersPlayNext, { offerId }),
    cancelNext: (offerId) => ipcRenderer.invoke(IPC.playersCancelNext, { offerId }),
    onNextUp: (listener) => {
      const handler = (_e: unknown, nextUp: NextUpOffer): void => listener(nextUp)
      ipcRenderer.on(IPC.evNextUp, handler)
      return () => ipcRenderer.removeListener(IPC.evNextUp, handler)
    },
    onNextUpCancelled: (listener) => {
      const handler = (_e: unknown, offerId: string): void => listener(offerId)
      ipcRenderer.on(IPC.evNextUpCancelled, handler)
      return () => ipcRenderer.removeListener(IPC.evNextUpCancelled, handler)
    },
  },
}

contextBridge.exposeInMainWorld('theama', bridge)
