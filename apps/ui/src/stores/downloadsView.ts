import { defineStore } from 'pinia'
import type { DownloadTool, GenreMode, Release, ReleaseKind, Resolution, Suggestion } from '@theama/contracts'
import type { Filter, SortKey } from '@/components/downloads/activeList'
import type { ReleaseSort } from '@/components/downloads/releaseSort'

export type ReleaseQuery = { kind: ReleaseKind; title: string; year?: number | undefined; season?: number | undefined; episode?: number | undefined; collectionName?: string | undefined; externalId?: string | undefined }
export type DownloadsPane = 'find' | 'favorites' | 'active' | 'releases'

export function suggestionPage() {
  return { items: [] as Suggestion[], page: 0, hasMore: false, loaded: false, problem: null as string | null }
}

export function releaseState(query: ReleaseQuery) {
  return {
    sourceKey: JSON.stringify(query), active: query,
    title: query.title, year: query.year === undefined ? '' : String(query.year),
    season: query.season === undefined ? '' : String(query.season), episode: query.episode === undefined ? '' : String(query.episode),
    items: [] as Release[], received: 0, loaded: false,
    error: null as { code: string; message: string; tool: DownloadTool } | null,
    resolution: null as Resolution | null, minSeeders: '', sort: 'quality' as ReleaseSort,
    seasonFilter: null as number | null, episodeFilter: null as number | null,
    unmatched: false, sent: new Set<string>(),
  }
}

/** Controls and loaded pages live outside the view, only for this app session. */
export const useDownloadsViewStore = defineStore('downloadsView', {
  state: () => ({
    tab: 'find' as 'find' | 'favorites' | 'active',
    favoriteKind: 'all' as ReleaseKind | 'all',
    kind: 'all' as ReleaseKind | 'all',
    genres: [] as string[],
    genreMode: 'any' as GenreMode,
    text: '',
    selectedYears: [] as number[],
    ratingRange: [0, 10] as [number, number],
    season: '',
    episode: '',
    matches: null as Suggestion[] | null,
    searchProblem: null as string | null,
    searchPending: false,
    query: null as ReleaseQuery[] | null,
    person: null as { externalId: string; category: 'actor' | 'director'; name: string } | null,
    contextKey: '',
    contextPosition: null as number | null,
    yearCount: 5,
    suggestionPages: {} as Record<string, ReturnType<typeof suggestionPage>>,
    personResults: {} as Record<string, { items: Suggestion[]; loaded: boolean; problem: string | null }>,
    releases: {} as Partial<Record<ReleaseKind, ReturnType<typeof releaseState>>>,
    scrolls: { find: 0, favorites: 0, active: 0, releases: 0 } as Record<DownloadsPane, number>,
    activeSearch: '',
    activeFilter: 'all' as Filter,
    activeSort: 'added' as SortKey,
    activeDescending: true,
  }),
})
