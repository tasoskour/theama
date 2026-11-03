import type { LocationQuery } from 'vue-router'
import { ReleaseQuery, type CollectionKind, type CollectionMember, type ReleaseKind } from '@theama/contracts'

export interface ReleaseSearchTarget {
  kind: ReleaseKind
  title: string
  year?: number | undefined
  season?: number | undefined
  episode?: number | undefined
  collectionName?: string | undefined
}

/** Deep links accept whole numbers only, within the same bounds as the release API. */
function routeNumber(value: LocationQuery[string] | undefined, field: 'year' | 'season' | 'episode'): number | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined
  const parsed = ReleaseQuery.shape[field].safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function releaseSearchFromRoute(query: LocationQuery): ReleaseSearchTarget | null {
  const parsed = ReleaseQuery.pick({ kind: true, title: true }).safeParse(query)
  if (!parsed.success) return null
  const { kind, title } = parsed.data
  if (kind === 'movie') {
    const collectionName = typeof query.collectionName === 'string' ? ReleaseQuery.shape.collectionName.safeParse(query.collectionName) : null
    return { kind, title, year: routeNumber(query.year, 'year'), ...(collectionName?.success ? { collectionName: collectionName.data } : {}) }
  }
  const season = routeNumber(query.season, 'season')
  return { kind, title, season, episode: season === undefined ? undefined : routeNumber(query.episode, 'episode') }
}

export function releaseSearchRoute(target: ReleaseSearchTarget): { name: 'downloads'; query: LocationQuery } {
  return {
    name: 'downloads',
    query: {
      releases: '1', kind: target.kind, title: target.title,
      ...(target.kind === 'movie' && target.year !== undefined ? { year: String(target.year) } : {}),
      ...(target.kind === 'movie' && target.collectionName ? { collectionName: target.collectionName } : {}),
      ...(target.kind === 'series' && target.season !== undefined ? {
        season: String(target.season),
        ...(target.episode !== undefined ? { episode: String(target.episode) } : {}),
      } : {}),
    },
  }
}

/** Official sets contain movies; absent user members retain their kind in the stored title key. */
export function collectionReleaseTarget(member: CollectionMember, kind: CollectionKind, collectionName?: string): ReleaseSearchTarget | null {
  if (member.summary) return null
  const releaseKind = kind === 'official' || member.titleKey?.startsWith('movie:') ? 'movie'
    : member.titleKey?.startsWith('series:') ? 'series' : null
  if (!releaseKind) return null
  return { kind: releaseKind, title: member.title, ...(releaseKind === 'movie' && member.year !== null ? { year: member.year } : {}), ...(kind === 'official' && collectionName ? { collectionName } : {}) }
}
