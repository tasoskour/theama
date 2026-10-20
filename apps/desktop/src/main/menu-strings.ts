import type { ServiceState, UiLanguage } from '@theama/contracts'

export interface MenuStrings {
  openTheama: string
  file: string
  quit: string
  edit: string
  view: string
  reload: string
  toggleDevTools: string
  zoomIn: string
  zoomOut: string
  zoomReset: string
  fullscreen: string
  go: string
  home: string
  movies: string
  series: string
  videos: string
  search: string
  collections: string
  settings: string
  back: string
  service: string
  serviceStatus: (state: string) => string
  start: string
  stop: string
  restart: string
  install: string
  repair: string
  uninstall: string
  logHistory: string
  serviceSettings: string
  openLogsFolder: string
  state: Record<ServiceState, string>
  errorTitle: string
  confirmUninstallTitle: string
  confirmUninstallBody: string
  confirmUninstall: string
  cancel: string
  pickFolder: string
}

const en: MenuStrings = {
  openTheama: 'Open Theama',
  file: '&File',
  quit: 'Quit Theama',
  edit: '&Edit',
  view: '&View',
  reload: 'Reload',
  toggleDevTools: 'Toggle Developer Tools',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  zoomReset: 'Actual Size',
  fullscreen: 'Toggle Full Screen',
  go: '&Go',
  home: 'Home',
  movies: 'Movies',
  series: 'Series',
  videos: 'My Videos',
  search: 'Search',
  collections: 'Collections',
  settings: 'Settings',
  back: 'Back',
  service: '&Service',
  serviceStatus: (s) => `Service: ${s}`,
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  install: 'Install…',
  repair: 'Repair…',
  uninstall: 'Uninstall…',
  logHistory: 'Log History',
  serviceSettings: 'Service Settings',
  openLogsFolder: 'Open Logs Folder',
  state: {
    'not-installed': 'not installed',
    stopped: 'stopped',
    'start-pending': 'starting…',
    running: 'running',
    'stop-pending': 'stopping…',
    paused: 'paused',
    unknown: 'unknown',
  },
  errorTitle: 'Theama service',
  confirmUninstallTitle: 'Remove the Theama service?',
  confirmUninstallBody: 'Your library data, settings and logs stay on disk. You can install the service again at any time.',
  confirmUninstall: 'Remove service',
  cancel: 'Cancel',
  pickFolder: 'Choose a media folder',
}

const el: MenuStrings = {
  openTheama: 'Άνοιγμα του Θέαμα',
  file: '&Αρχείο',
  quit: 'Έξοδος από το Θέαμα',
  edit: '&Επεξεργασία',
  view: '&Προβολή',
  reload: 'Επαναφόρτωση',
  toggleDevTools: 'Εργαλεία προγραμματιστή',
  zoomIn: 'Μεγέθυνση',
  zoomOut: 'Σμίκρυνση',
  zoomReset: 'Πραγματικό μέγεθος',
  fullscreen: 'Πλήρης οθόνη',
  go: '&Μετάβαση',
  home: 'Αρχική',
  movies: 'Ταινίες',
  series: 'Σειρές',
  videos: 'Τα βίντεό μου',
  search: 'Αναζήτηση',
  collections: 'Συλλογές',
  settings: 'Ρυθμίσεις',
  back: 'Πίσω',
  service: '&Υπηρεσία',
  serviceStatus: (s) => `Υπηρεσία: ${s}`,
  start: 'Εκκίνηση',
  stop: 'Διακοπή',
  restart: 'Επανεκκίνηση',
  install: 'Εγκατάσταση…',
  repair: 'Επισκευή…',
  uninstall: 'Απεγκατάσταση…',
  logHistory: 'Ιστορικό καταγραφής',
  serviceSettings: 'Ρυθμίσεις υπηρεσίας',
  openLogsFolder: 'Άνοιγμα φακέλου καταγραφών',
  state: {
    'not-installed': 'δεν είναι εγκατεστημένη',
    stopped: 'σταματημένη',
    'start-pending': 'εκκίνηση…',
    running: 'εκτελείται',
    'stop-pending': 'διακοπή…',
    paused: 'σε παύση',
    unknown: 'άγνωστη',
  },
  errorTitle: 'Υπηρεσία Θέαμα',
  confirmUninstallTitle: 'Αφαίρεση της υπηρεσίας Θέαμα;',
  confirmUninstallBody: 'Τα δεδομένα βιβλιοθήκης, οι ρυθμίσεις και οι καταγραφές παραμένουν στον δίσκο. Μπορείτε να εγκαταστήσετε ξανά την υπηρεσία οποιαδήποτε στιγμή.',
  confirmUninstall: 'Αφαίρεση υπηρεσίας',
  cancel: 'Ακύρωση',
  pickFolder: 'Επιλέξτε φάκελο πολυμέσων',
}

export function menuStrings(lang: UiLanguage): MenuStrings {
  return lang === 'el' ? el : en
}
