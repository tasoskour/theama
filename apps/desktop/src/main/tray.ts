import { Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ServiceStatus, UiLanguage } from '@theama/contracts'
import { menuStrings } from './menu-strings'

export interface TrayActions {
  open(): void
  quit(): void
}

/**
 * The notification-area icon: shown only while "keep Theama running in the tray" is on. Clicking it opens
 * the window; its menu names the service's state and offers Open and Quit. The service itself is unaffected
 * by any of this: it keeps managing the library whether the window, the tray or neither is there.
 */
export class TrayIcon {
  private tray: Tray | null = null

  constructor(
    private readonly brandDir: string,
    private readonly actions: TrayActions,
  ) {}

  get active(): boolean {
    return this.tray !== null
  }

  show(language: UiLanguage, status: ServiceStatus | null): void {
    if (!this.tray) {
      const small = join(this.brandDir, 'tray-16.png')
      const large = join(this.brandDir, 'tray-32.png')
      if (!existsSync(small)) return // no icon, no tray: the window then closes normally
      const image = nativeImage.createFromPath(small)
      if (existsSync(large)) image.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromPath(large).toPNG() })
      this.tray = new Tray(image)
      this.tray.on('click', () => this.actions.open())
    }
    this.refresh(language, status)
  }

  refresh(language: UiLanguage, status: ServiceStatus | null): void {
    if (!this.tray) return
    const s = menuStrings(language)
    this.tray.setToolTip(`Theama${status ? ` - ${s.serviceStatus(s.state[status.state])}` : ''}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: s.openTheama, click: () => this.actions.open() },
        { label: status ? s.serviceStatus(s.state[status.state]) : s.serviceStatus(s.state.unknown), enabled: false },
        { type: 'separator' },
        { label: s.quit, click: () => this.actions.quit() },
      ]),
    )
  }

  hide(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
