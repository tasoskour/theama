import { defineStore } from 'pinia'
import type { GenreMode, ReleaseKind } from '@theama/contracts'
import type { Filter, SortKey } from '@/components/downloads/activeList'

/** Downloads controls remembered only for the lifetime of this app session. */
export const useDownloadsViewStore = defineStore('downloadsView', {
  state: () => ({
    tab: 'find' as 'find' | 'favorites' | 'active',
    favoriteKind: 'all' as ReleaseKind | 'all',
    kind: 'all' as ReleaseKind | 'all',
    genres: [] as string[],
    genreMode: 'any' as GenreMode,
    text: '',
    year: null as number | null,
    season: '',
    episode: '',
    activeSearch: '',
    activeFilter: 'all' as Filter,
    activeSort: 'added' as SortKey,
    activeDescending: true,
  }),
})
