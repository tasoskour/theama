import type { Release, ReleaseKind } from '@theama/contracts'

export interface ReleaseGroup {
  key: string
  type: 'collection' | 'movie' | 'complete' | 'season' | 'episode' | 'other'
  season?: number
  episode?: number
  items: Release[]
}

/** Keep server ranking within each group while placing packs before individual releases. */
export function groupReleases(items: Release[], kind: ReleaseKind): ReleaseGroup[] {
  const groups = new Map<string, ReleaseGroup>()
  for (const item of items) {
    let identity: Omit<ReleaseGroup, 'items'>
    if (kind === 'movie') identity = item.collectionPack ? { key: 'collection', type: 'collection' } : { key: 'movie', type: 'movie' }
    else if (item.pack && item.season === null) identity = { key: 'complete', type: 'complete' }
    else if (item.pack && item.season !== null) identity = { key: `season-${item.season}`, type: 'season', season: item.season }
    else if (item.season !== null && item.episode !== null) identity = { key: `episode-${item.season}-${item.episode}`, type: 'episode', season: item.season, episode: item.episode }
    else identity = { key: 'other', type: 'other' }
    const group = groups.get(identity.key) ?? { ...identity, items: [] }
    group.items.push(item)
    groups.set(identity.key, group)
  }
  const order: Record<ReleaseGroup['type'], number> = { collection: 0, complete: 0, season: 1, movie: 1, episode: 2, other: 3 }
  return [...groups.values()].sort((a, b) => order[a.type] - order[b.type] || a.key.localeCompare(b.key, undefined, { numeric: true }))
}
