import type { SetupResourceId } from '@theama/contracts'
import type { SetupItem } from './content'

/** Static facts about each wizard card. Texts live in the `setup.items.<id>` i18n keys (step1..stepN). */
export const ITEM_CONTENT: Record<SetupItem, { steps: number; links: SetupResourceId[]; status: 'metadata' | 'prowlarr' | 'downloads' | 'subtitles' }> = {
  tmdb: { steps: 4, links: ['tmdbSignup', 'tmdbApi'], status: 'metadata' },
  prowlarr: { steps: 5, links: ['prowlarr', 'prowlarrDocs'], status: 'prowlarr' },
  qbittorrent: { steps: 4, links: ['qbittorrent', 'qbittorrentOptions'], status: 'downloads' },
  subtitles: { steps: 3, links: ['opensubtitles', 'subdl'], status: 'subtitles' },
}

const shots = import.meta.glob('../assets/setup/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default' }) as Record<string, string>

/** Screenshots dropped into assets/setup as `<item>-<n>.png`, in order; none when the folder has none. */
export function screenshotsFor(item: SetupItem): string[] {
  return Object.entries(shots)
    .filter(([path]) => new RegExp(`/${item}-\\d+\\.`).test(path))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, url]) => url)
}
