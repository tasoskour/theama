import { SETUP_RESOURCES, type SetupResourceId } from '@theama/contracts'
import type { SetupItem } from './content'
import tmdbIcon from '@/assets/setup/icons/tmdb.svg'
import opensubtitlesIcon from '@/assets/setup/icons/opensubtitles.svg'
import subdlIcon from '@/assets/setup/icons/subdl.svg'
import prowlarrIcon from '@/assets/download-tools/prowlarr.svg'
import qbittorrentIcon from '@/assets/download-tools/qbittorrent.svg'

/** One website or app with its own links and numbered steps. Texts: `setup.items.<item>.<group>.step<n>` (title) and `step<n>d` (details). */
export interface ItemGroup {
  key: string
  icon: string
  links: SetupResourceId[]
  steps: number
  /** The first link downloads an app; the card shows an "Installed" chip when that app is found. */
  installable?: 'prowlarr' | 'qbittorrent'
}
export interface ItemContent {
  icon: string
  status: 'metadata' | 'prowlarr' | 'downloads' | 'subtitles'
  groups: ItemGroup[]
}

export const ITEM_CONTENT: Record<SetupItem, ItemContent> = {
  tmdb: { icon: tmdbIcon, status: 'metadata', groups: [{ key: 'main', icon: tmdbIcon, links: ['tmdbSignup', 'tmdbApi'], steps: 6 }] },
  prowlarr: { icon: prowlarrIcon, status: 'prowlarr', groups: [{ key: 'main', icon: prowlarrIcon, links: ['prowlarr', 'prowlarrDocs'], steps: 6, installable: 'prowlarr' }] },
  qbittorrent: { icon: qbittorrentIcon, status: 'downloads', groups: [{ key: 'main', icon: qbittorrentIcon, links: ['qbittorrent', 'qbittorrentOptions'], steps: 6, installable: 'qbittorrent' }] },
  subtitles: {
    icon: opensubtitlesIcon,
    status: 'subtitles',
    groups: [
      { key: 'opensubtitles', icon: opensubtitlesIcon, links: ['opensubtitles'], steps: 5 },
      { key: 'subdl', icon: subdlIcon, links: ['subdl'], steps: 4 },
    ],
  },
}

export const LINK_ICON: Partial<Record<SetupResourceId, string>> = {
  tmdbSignup: tmdbIcon, tmdbApi: tmdbIcon,
  prowlarr: prowlarrIcon, prowlarrDocs: prowlarrIcon,
  qbittorrent: qbittorrentIcon, qbittorrentOptions: qbittorrentIcon,
  opensubtitles: opensubtitlesIcon, subdl: subdlIcon,
}

const shots = import.meta.glob('../assets/setup/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default' }) as Record<string, string>
const shotByName = new Map(Object.entries(shots).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1).replace(/[.][a-z]+$/, ''), url]))

/** A screenshot dropped into assets/setup as `<item>-<n>.png` (single-site items) or `<item>-<group>-<n>.png`; none when missing. */
export function screenshotFor(item: SetupItem, group: string, step: number): string | null {
  const base = group === 'main' ? item : `${item}-${group}`
  return shotByName.get(`${base}-${step}`) ?? null
}

/** `host/path` of a link, shown under its label so people know where it leads. */
export function linkHost(resource: SetupResourceId): string {
  const url = new URL(SETUP_RESOURCES[resource])
  return (url.host + url.pathname).replace(/^www[.]/, '').replace(/[/]$/, '')
}
