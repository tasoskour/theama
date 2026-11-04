import type { Release, Resolution } from '@theama/contracts'

export type ReleaseSort = 'quality' | 'seeders'

const RESOLUTION_RANK: Record<Resolution, number> = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 }

/** Same ordering the server used to apply: seeded releases first, then better resolution; "seeders" puts the most seeded first. */
export function sortReleases(items: Release[], sort: ReleaseSort): Release[] {
  return [...items].sort((a, b) => {
    if (sort === 'seeders' && a.seeders !== b.seeders) return b.seeders - a.seeders
    const dead = Number(b.seeders > 0) - Number(a.seeders > 0)
    if (dead !== 0) return dead
    const res = (b.resolution ? RESOLUTION_RANK[b.resolution] : 0) - (a.resolution ? RESOLUTION_RANK[a.resolution] : 0)
    return res !== 0 ? res : b.seeders - a.seeders || a.title.localeCompare(b.title)
  })
}

export interface ReleaseFilter {
  resolution: Resolution | null
  minSeeders: number
  season: number | null
  episode: number | null
}

/** A chosen season keeps its pack and episodes; a chosen episode keeps that episode and the season's pack. */
export function filterReleases(items: Release[], f: ReleaseFilter): Release[] {
  return items.filter((i) => {
    if (f.resolution && i.resolution !== f.resolution) return false
    if (i.seeders < f.minSeeders) return false
    if (f.season !== null) {
      if (i.season !== f.season) return false
      if (f.episode !== null && !i.pack && i.episode !== f.episode) return false
    }
    return true
  })
}

export function seasonsOf(items: Release[]): number[] {
  return [...new Set(items.flatMap((i) => (i.season === null ? [] : [i.season])))].sort((a, b) => a - b)
}

export function episodesOf(items: Release[], season: number | null): number[] {
  if (season === null) return []
  return [...new Set(items.flatMap((i) => (i.season === season && !i.pack && i.episode !== null ? [i.episode] : [])))].sort((a, b) => a - b)
}
