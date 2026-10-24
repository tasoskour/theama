import type { DownloadItem, DownloadState } from '@theama/contracts'

export type Bucket = 'downloading' | 'paused' | 'finished' | 'problems'
export type Filter = 'all' | Bucket
export type SortKey = 'added' | 'name' | 'progress' | 'size' | 'speed'

export const BUCKETS: readonly Bucket[] = ['downloading', 'paused', 'finished', 'problems']
export const SORT_KEYS: readonly SortKey[] = ['added', 'name', 'progress', 'size', 'speed']

/** The few groups a person thinks in, out of qBittorrent's many states. */
export function bucket(state: DownloadState): Bucket {
  if (state === 'paused') return 'paused'
  if (state === 'completed') return 'finished'
  if (state === 'error') return 'problems'
  return 'downloading'
}

/** Lower case without accents, so "ΤΑΙΝΙΑ" finds "ταινία" and "amelie" finds "Amélie". */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export interface ListOptions {
  search: string
  filter: Filter
  sort: SortKey
  /** Largest, latest or Z first. */
  descending: boolean
}

function compare(a: DownloadItem, b: DownloadItem, sort: SortKey): number {
  switch (sort) {
    case 'name':
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    case 'progress':
      return a.progress - b.progress
    case 'size':
      return a.size - b.size
    case 'speed':
      return a.downloadSpeed - b.downloadSpeed
    case 'added':
      // Torrents without a date sort as the oldest.
      return (a.addedAt ? Date.parse(a.addedAt) : 0) - (b.addedAt ? Date.parse(b.addedAt) : 0)
  }
}

export function filterAndSort(items: readonly DownloadItem[], o: ListOptions): DownloadItem[] {
  const needle = fold(o.search.trim())
  const out = items.filter((i) => (o.filter === 'all' || bucket(i.state) === o.filter) && (needle === '' || fold(i.name).includes(needle)))
  const dir = o.descending ? -1 : 1
  // Ties fall back to the name so the order does not jump around while progress updates.
  return out.sort((a, b) => dir * compare(a, b, o.sort) || a.name.localeCompare(b.name) || a.hash.localeCompare(b.hash))
}

export function counts(items: readonly DownloadItem[]): Record<Filter, number> {
  const out: Record<Filter, number> = { all: items.length, downloading: 0, paused: 0, finished: 0, problems: 0 }
  for (const i of items) out[bucket(i.state)]++
  return out
}

/** Bytes per second across everything that is moving. */
export const totalSpeed = (items: readonly DownloadItem[]): number => items.reduce((sum, i) => sum + (i.state === 'downloading' ? i.downloadSpeed : 0), 0)
