import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type LogEntry, type ServiceStatus, type TheamaBridge } from '@theama/contracts'

// The renderer is sandboxed with no Node access. This is its only door to the
// system, and every call is validated again in the main process.
const bridge: TheamaBridge = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  setLanguage: (language) => ipcRenderer.invoke(IPC.setLanguage, { language }),
  pickFolder: (title) => ipcRenderer.invoke(IPC.pickFolder, { title }),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, { path }),
  showItemInFolder: (path) => ipcRenderer.invoke(IPC.showItemInFolder, { path }),
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
  onNavigate: (listener) => {
    const handler = (_e: unknown, route: string) => listener(route)
    ipcRenderer.on(IPC.evNavigate, handler)
    return () => ipcRenderer.off(IPC.evNavigate, handler)
  },
}

contextBridge.exposeInMainWorld('theama', bridge)
