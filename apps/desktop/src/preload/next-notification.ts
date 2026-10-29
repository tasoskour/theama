import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type NextNotificationState } from '@theama/contracts'

// This window can only display and act on an offer; it has no filesystem, settings or general player bridge.
contextBridge.exposeInMainWorld('nextEpisodeNotice', {
  onUpdate(listener: (state: NextNotificationState) => void) {
    ipcRenderer.on(IPC.evNextNotification, (_event, state: NextNotificationState) => listener(state))
  },
  act(action: 'play' | 'cancel', offerId: string) {
    ipcRenderer.send(IPC.nextNotificationAction, { action, offerId })
  },
})
