import type { MediaFile } from '@theama/contracts'

/**
 * Several files can play the same movie or episode (two qualities, or one file in two folders). The detail
 * page shows it once, plays one of the files, and lets the person switch to another path.
 */

const STORAGE_KEY = 'theama.pathChoices'
/** Old choices are dropped beyond this many, oldest first, so the entry cannot grow without bound. */
const MAX_CHOICES = 500

type Choices = Record<string, number>
type Store = Pick<Storage, 'getItem' | 'setItem'>

const playable = (f: MediaFile): boolean => f.state === 'available'

/** The copy to use unless the person picked one: present on disk, then one they were watching, then the sharpest. */
export function pickDefaultFile(files: readonly MediaFile[]): MediaFile | null {
  let best: MediaFile | null = null
  const rank = (f: MediaFile): [number, number, number] => [playable(f) ? 1 : 0, f.positionSeconds !== null ? 1 : 0, f.height ?? 0]
  for (const f of files) {
    if (!best) {
      best = f
      continue
    }
    const a = rank(f)
    const b = rank(best)
    if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) best = f
  }
  return best
}

/** The chosen file when it is still among `files`, otherwise the default one. */
export function resolveChoice(files: readonly MediaFile[], chosenId: number | undefined): MediaFile | null {
  return files.find((f) => f.id === chosenId) ?? pickDefaultFile(files)
}

/** Files that play one episode, in the order the episodes first appear; a file without an episode number stands alone. */
export function groupEpisodeFiles(files: readonly MediaFile[]): MediaFile[][] {
  const groups = new Map<string, MediaFile[]>()
  for (const f of files) {
    const key = f.episode === null ? `f${f.id}` : `${f.season ?? ''}:${f.episode}`
    const group = groups.get(key)
    if (group) group.push(f)
    else groups.set(key, [f])
  }
  return [...groups.values()]
}

/** Where a movie's or an episode's choice is kept. */
export const movieChoiceKey = (titleKey: string): string => titleKey
export const episodeChoiceKey = (titleKey: string, season: number | null, episode: number | null): string => `${titleKey}:${season ?? ''}:${episode ?? ''}`

function defaultStore(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Remembered choices (file ids by key); an unreadable or missing store gives none. */
export function loadChoices(store: Store | null = defaultStore()): Choices {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(STORAGE_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, number] => Number.isInteger(e[1])))
  } catch {
    return {}
  }
}

/** Remembers the file chosen for a key; failing to write (private window, blocked storage) is not an error. */
export function saveChoice(key: string, fileId: number, store: Store | null = defaultStore()): void {
  try {
    const choices = loadChoices(store)
    delete choices[key] // re-added last, so the newest choices are the ones kept
    choices[key] = fileId
    const kept = Object.entries(choices).slice(-MAX_CHOICES)
    store?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    /* the choice just applies until the page is reloaded */
  }
}
