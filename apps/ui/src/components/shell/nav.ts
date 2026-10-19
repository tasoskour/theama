import {
  mdiCogOutline,
  mdiFolderMultipleOutline,
  mdiHomeOutline,
  mdiMagnify,
  mdiMovieOpenOutline,
  mdiTelevisionClassic,
  mdiVideoOutline,
} from '@mdi/js'

export interface NavItem {
  to: string
  labelKey: string
  icon: string
  /** Whether the item appears in the mobile bottom bar (others go to the overflow menu). */
  bottom: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: mdiHomeOutline, bottom: true },
  { to: '/movies', labelKey: 'nav.movies', icon: mdiMovieOpenOutline, bottom: true },
  { to: '/series', labelKey: 'nav.series', icon: mdiTelevisionClassic, bottom: true },
  { to: '/videos', labelKey: 'nav.videos', icon: mdiVideoOutline, bottom: true },
  { to: '/search', labelKey: 'nav.search', icon: mdiMagnify, bottom: true },
  { to: '/collections', labelKey: 'nav.collections', icon: mdiFolderMultipleOutline, bottom: false },
  { to: '/settings', labelKey: 'nav.settings', icon: mdiCogOutline, bottom: false },
]
