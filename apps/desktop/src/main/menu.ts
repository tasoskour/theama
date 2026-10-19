import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { ServiceStatus, UiLanguage } from '@theama/contracts'
import { menuStrings } from './menu-strings'

export type ServiceMenuAction = 'start' | 'stop' | 'restart' | 'install' | 'repair' | 'uninstall'

export interface MenuActions {
  navigate(route: string): void
  back(): void
  service(action: ServiceMenuAction): void
  openLogsFolder(): void
  quit(): void
}

export interface MenuState {
  language: UiLanguage
  status: ServiceStatus | null
  dev: boolean
  busy: boolean
}

/** Native application menu, including the Service menu that manages the backend. */
export function buildMenu(state: MenuState, actions: MenuActions): Menu {
  const s = menuStrings(state.language)
  const st = state.status
  const installed = st !== null && st.state !== 'not-installed'
  const isNssm = st?.host === 'nssm'
  const running = st?.state === 'running'
  const stopped = st?.state === 'stopped'
  const idle = !state.busy && st?.state !== 'start-pending' && st?.state !== 'stop-pending'
  const stateLabel = st ? s.state[st.state] : s.state.unknown

  const goItem = (label: string, route: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => actions.navigate(route),
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: s.file,
      submenu: [{ label: s.quit, accelerator: 'Alt+F4', click: () => actions.quit() }],
    },
    { label: s.edit, role: 'editMenu' },
    {
      label: s.go,
      submenu: [
        goItem(s.home, '/', 'CmdOrCtrl+1'),
        goItem(s.movies, '/movies', 'CmdOrCtrl+2'),
        goItem(s.series, '/series', 'CmdOrCtrl+3'),
        goItem(s.videos, '/videos', 'CmdOrCtrl+4'),
        goItem(s.collections, '/collections', 'CmdOrCtrl+5'),
        goItem(s.search, '/search'),
        goItem(s.settings, '/settings', 'CmdOrCtrl+,'),
        { type: 'separator' },
        { label: s.back, accelerator: 'Alt+Left', click: () => actions.back() },
      ],
    },
    {
      label: s.service,
      submenu: [
        { label: s.serviceStatus(stateLabel), enabled: false },
        { type: 'separator' },
        { label: s.start, enabled: installed && !running && idle, click: () => actions.service('start') },
        { label: s.stop, enabled: installed && !stopped && idle, click: () => actions.service('stop') },
        { label: s.restart, enabled: installed && idle, click: () => actions.service('restart') },
        ...((isNssm || !installed
          ? [
              { type: 'separator' },
              installed
                ? { label: s.repair, enabled: idle, click: () => actions.service('repair') }
                : { label: s.install, enabled: idle, click: () => actions.service('install') },
              { label: s.uninstall, enabled: installed && idle, click: () => actions.service('uninstall') },
            ]
          : []) as MenuItemConstructorOptions[]),
        { type: 'separator' },
        goItem(s.serviceSettings, '/settings/advanced/service'),
        goItem(s.logHistory, '/settings/advanced/logs', 'CmdOrCtrl+Shift+L'),
        { label: s.openLogsFolder, click: () => actions.openLogsFolder() },
      ],
    },
    {
      label: s.view,
      submenu: [
        { label: s.reload, role: 'reload' },
        ...(state.dev ? [{ label: s.toggleDevTools, role: 'toggleDevTools' } as MenuItemConstructorOptions] : []),
        { type: 'separator' },
        { label: s.zoomIn, role: 'zoomIn' },
        { label: s.zoomOut, role: 'zoomOut' },
        { label: s.zoomReset, role: 'resetZoom' },
        { type: 'separator' },
        { label: s.fullscreen, role: 'togglefullscreen' },
      ],
    },
  ]
  return Menu.buildFromTemplate(template)
}
