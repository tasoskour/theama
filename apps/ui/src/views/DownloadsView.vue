<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { mdiClose } from '@mdi/js'
import { useI18n } from 'vue-i18n'
import type { GenreMode, MatchCandidate, ReleaseKind } from '@theama/contracts'
import GenreFilter from '@/components/common/GenreFilter.vue'
import ActiveDownloads from '@/components/downloads/ActiveDownloads.vue'
import DownloadToolsPanel from '@/components/downloads/DownloadToolsPanel.vue'
import ReleaseList from '@/components/downloads/ReleaseList.vue'
import SuggestionGrid from '@/components/downloads/SuggestionGrid.vue'
import SuggestionSection from '@/components/downloads/SuggestionSection.vue'
import SuggestionDetailsDialog from '@/components/downloads/SuggestionDetailsDialog.vue'
import type { SuggestionItem } from '@/components/downloads/suggestion'
import TrailerDialog from '@/components/titles/TrailerDialog.vue'
import { imdbLinkFor, openExternal, trailerInApp } from '@/composables/useExternalLinks'
import { useDownloadsStore } from '@/stores/downloads'
import { useMetadataStore } from '@/stores/metadata'
import { useFavoritesStore } from '@/stores/favorites'

type Query = { kind: ReleaseKind; title: string; year?: number | undefined; season?: number | undefined; episode?: number | undefined }

const route = useRoute()
const { t } = useI18n()
const downloads = useDownloadsStore()
const metadata = useMetadataStore()
const favorites = useFavoritesStore()

const tab = ref<'find' | 'favorites' | 'active'>('find')
const favoriteKind = ref<ReleaseKind | 'all'>('all')
const shownFavorites = computed(() => favorites.items.filter((item) => favoriteKind.value === 'all' || item.kind === favoriteKind.value))
const kind = ref<ReleaseKind | 'all'>('all')
const genres = ref<string[]>([])
const genreMode = ref<GenreMode>('any')
const suggestionGenres = ref<string[]>([])
const genreProblem = ref<string | null>(null)
const genreRetry = ref(0)
const genreLoading = ref(false)
const suggestionFilterKey = computed(() => JSON.stringify([[...genres.value].sort(), genres.value.length > 1 ? genreMode.value : 'any']))
const text = ref('')
const year = ref<number | null>(null)
const season = ref('')
const episode = ref('')

/** Newest first: this year (and next, for what is announced) back to the first films. */
const FIRST_YEAR = 1900
const lastYear = new Date().getFullYear() + 1
const years = Array.from({ length: lastYear - FIRST_YEAR + 1 }, (_, i) => lastYear - i)

const searching = ref(false)
const matches = ref<MatchCandidate[] | null>(null)
const problem = ref<string | null>(null)
const query = ref<Query[] | null>(null)
const shownMatches = computed(() => matches.value?.filter((c) => genres.value.length === 0 || (
  genreMode.value === 'all' ? genres.value.every((genre) => c.genres?.includes(genre)) : genres.value.some((genre) => c.genres?.includes(genre))
)) ?? [])
const genreItems = computed(() => [...new Set([
  ...suggestionGenres.value,
  ...(matches.value ?? []).flatMap((c) => c.genres ?? []),
])].sort((a, b) => a.localeCompare(b)))

let searchGeneration = 0
onBeforeUnmount(() => { searchGeneration += 1 })

const setUp = computed(() => downloads.client?.state !== 'not_configured' || downloads.indexer?.state !== 'not_configured')
const hasKey = computed(() => metadata.status?.configured === true)
const noKey = computed(() => metadata.status !== null && !hasKey.value)
watch([hasKey, genreRetry], async ([configured], _previous, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  genreProblem.value = null
  genreLoading.value = configured
  if (!configured) {
    suggestionGenres.value = []
    return
  }
  const res = await metadata.genres()
  if (!current) return
  genreLoading.value = false
  if (res.ok) suggestionGenres.value = res.genres
  else genreProblem.value = res.message
}, { immediate: true })
const activeCount = computed(() => downloads.list?.items.length ?? 0)

// The suggestion sections: what is new, then this year and the years before it, five at a time.
const THIS_YEAR = new Date().getFullYear()
const YEARS_PER_STEP = 5
const yearCount = ref(YEARS_PER_STEP)
const sectionYears = computed(() => Array.from({ length: yearCount.value }, (_, i) => THIS_YEAR - i).filter((y) => y >= FIRST_YEAR))

const preview = ref<SuggestionItem | null>(null)
const previewOpen = ref(false)
const linkAction = ref<'trailer' | 'imdb' | null>(null)
const linkProblem = ref<string | null>(null)
let previewGeneration = 0
let previewActivator: HTMLElement | null = null
let trailerActivator: HTMLElement | null = null
const trailer = ref<{ key: string; title: string } | null>(null)
const trailerOpen = ref(false)

function invalidatePreview(): void {
  previewGeneration += 1
  linkAction.value = null
  linkProblem.value = null
}
watch(previewOpen, invalidatePreview, { flush: 'sync' })
onBeforeUnmount(invalidatePreview)

function openPreview(c: SuggestionItem): void {
  previewActivator = document.activeElement instanceof HTMLElement ? document.activeElement : null
  preview.value = c
  previewOpen.value = true
}

function restorePreviewFocus(): void {
  if (previewOpen.value) return
  // Removing a favorite can remove the card that opened this dialog.
  const target = previewActivator?.isConnected ? previewActivator : document.querySelector<HTMLElement>('.head__tabs [role="tab"][aria-selected="true"]')
  target?.focus({ preventScroll: true })
}

watch(trailerOpen, async (open) => {
  if (!open && previewOpen.value) {
    await nextTick()
    trailerActivator?.focus({ preventScroll: true })
  }
})

// Opening a preview uses the data already on the card. Links are fetched only on demand.
async function withDetails(c: MatchCandidate, action: 'trailer' | 'imdb', then: (d: { imdbId: string | null; trailer: { key: string } | null }) => void | Promise<void>): Promise<void> {
  if (linkAction.value || !previewOpen.value) return
  const mine = previewGeneration
  linkAction.value = action
  linkProblem.value = null
  try {
    const res = await metadata.suggestionDetails(c.kind, c.externalId)
    // A dismissed preview must not launch a late trailer or write into a different title's dialog.
    if (mine !== previewGeneration) return
    if (!res.ok) throw new Error(t('downloads.suggestions.details', { message: res.message }))
    await then(res)
  } catch (err) {
    if (mine === previewGeneration) linkProblem.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (mine === previewGeneration) linkAction.value = null
  }
}

const showTrailer = (c: MatchCandidate): Promise<void> => {
  trailerActivator = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return withDetails(c, 'trailer', (d) => {
    if (!d.trailer) throw new Error(t('downloads.suggestions.noTrailer'))
    if (trailerInApp) {
      trailer.value = { key: d.trailer.key, title: c.title }
      trailerOpen.value = true
    } else return openExternal({ service: 'youtube', id: d.trailer.key })
  })
}

const showImdb = (c: MatchCandidate): Promise<void> =>
  withDetails(c, 'imdb', (d) => {
    const link = imdbLinkFor(d.imdbId)
    if (!link) throw new Error(t('downloads.suggestions.noImdb'))
    return openExternal(link)
  })

// Emptying the title leaves the search and shows the suggestions again.
watch(text, (v) => {
  if (v.trim()) return
  searchGeneration += 1
  searching.value = false
  matches.value = null
  query.value = null
  problem.value = null
})

// Arriving from a title page ("Find a download…") fills the form in and searches straight away.
onMounted(() => {
  void downloads.load()
  const { kind: k, title, year: y } = route.query
  if ((k === 'movie' || k === 'series') && typeof title === 'string' && title.trim()) {
    kind.value = k
    text.value = title
    const fromTitle = typeof y === 'string' ? Number(y) : NaN
    if (k === 'movie' && years.includes(fromTitle)) year.value = fromTitle
    void search()
  }
})

const num = (v: string): number | undefined => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function openReleases(title: string, y?: number, selectedKind = kind.value): void {
  const t = title.trim()
  if (!t) return
  const kinds: ReleaseKind[] = selectedKind === 'all' ? ['movie', 'series'] : [selectedKind]
  query.value = kinds.map((k) =>
    k === 'movie' ? { kind: 'movie', title: t, year: y ?? year.value ?? undefined } : { kind: 'series', title: t, season: num(season.value), episode: num(season.value) === undefined ? undefined : num(episode.value) },
  )
}

async function search(): Promise<void> {
  const q = text.value.trim()
  if (!q || searching.value) return
  problem.value = null
  matches.value = null
  query.value = null
  if (!hasKey.value) {
    openReleases(q)
    return
  }
  searching.value = true
  const mine = ++searchGeneration
  const kinds: ReleaseKind[] = kind.value === 'all' ? ['movie', 'series'] : [kind.value]
  const results = await Promise.all(kinds.map((k) => metadata.search(k, q, k === 'movie' ? (year.value ?? undefined) : undefined)))
  if (mine !== searchGeneration) return
  searching.value = false
  const successful = results.filter((res) => res.ok)
  if (successful.length > 0) matches.value = successful.flatMap((res) => res.items)
  const failure = results.find((res) => !res.ok)
  if (failure && !failure.ok) problem.value = failure.message
}

// Suggestions mix movies and series, so the pick decides which kind of release to look for.
const pick = (c: MatchCandidate): void => {
  previewOpen.value = false
  tab.value = 'find'
  openReleases(c.title, c.year ?? undefined, c.kind)
}

function changeKind(): void {
  searchGeneration += 1
  searching.value = false
  matches.value = null
  query.value = null
  problem.value = null
}
</script>

<template>
  <div class="th-page th-page--wide">
    <header class="th-page-header head">
      <h1 class="th-display th-page-title">{{ $t('downloads.title') }}</h1>
      <v-tabs v-model="tab" density="compact" color="primary" show-arrows class="head__tabs">
        <v-tab value="find" data-test="tab-find">{{ $t('downloads.find.tab') }}</v-tab>
        <v-tab value="favorites" data-test="tab-favorites">{{ $t('downloads.favorites.tab') }}</v-tab>
        <v-tab value="active" data-test="tab-active">
          {{ $t('downloads.active.heading') }}
          <v-chip v-if="activeCount > 0" size="x-small" class="ml-2" data-test="active-count">{{ activeCount }}</v-chip>
        </v-tab>
      </v-tabs>
    </header>

    <DownloadToolsPanel />

    <v-alert v-if="favorites.error" type="warning" variant="tonal" class="mb-4" data-test="favorites-error">
      {{ $t('downloads.favorites.error', { message: favorites.error }) }}
      <v-btn variant="text" size="small" data-test="favorites-retry" @click="favorites.retry()">{{ $t('downloads.favorites.retry') }}</v-btn>
    </v-alert>

    <v-alert v-if="downloads.client && downloads.indexer && !setUp" type="info" variant="tonal" density="compact" class="mb-4" data-test="downloads-setup">
      {{ $t('downloads.find.setup') }}
      <router-link to="/settings/downloads">{{ $t('downloads.find.openSettings') }}</router-link>
    </v-alert>

    <section v-show="tab === 'find'" class="find">
      <form class="find__row" role="search" @submit.prevent="search">
        <v-btn-toggle v-model="kind" mandatory divided variant="outlined" density="compact" color="primary" class="find__kind th-toggle-control" :aria-label="$t('downloads.suggestions.filter')" data-test="suggestion-filter" @update:model-value="changeKind">
          <v-btn v-for="filter in (['all', 'series', 'movie'] as const)" :key="filter" :value="filter" :aria-pressed="kind === filter" :data-test="`suggestion-filter-${filter}`">
            {{ $t(`downloads.suggestions.filters.${filter}`) }}
          </v-btn>
        </v-btn-toggle>
        <v-text-field
          v-model="text"
          :placeholder="$t('downloads.find.label')"
          :aria-label="$t('downloads.find.label')"
          density="compact"
          variant="solo-filled"
          flat
          bg-color="surface-bright"
          hide-details
          clearable
          :clear-icon="mdiClose"
          :clear-label="$t('downloads.find.clear')"
          class="find__text th-search-control"
          data-test="find-title"
          @click:clear="text = ''"
        />
        <GenreFilter
          v-if="hasKey"
          v-model="genres"
          v-model:mode="genreMode"
          :items="genreItems"
          class="find__genre"
          data-test="find-genre"
        />
        <v-autocomplete
          v-if="kind === 'movie'"
          v-model="year"
          :items="years"
          :placeholder="$t('downloads.find.year')"
          :aria-label="$t('downloads.find.year')"
          density="compact"
          variant="solo-filled"
          flat
          bg-color="surface-bright"
          hide-details
          clearable
          auto-select-first
          class="find__year th-search-control"
          data-test="find-year"
        />
        <div v-else-if="kind === 'series'" class="find__episodes">
          <v-text-field v-model="season" :placeholder="$t('downloads.find.season')" :aria-label="$t('downloads.find.season')" inputmode="numeric" density="compact" variant="solo-filled" flat bg-color="surface-bright" hide-details class="find__small th-search-control" data-test="find-season" />
          <v-text-field v-model="episode" :placeholder="$t('downloads.find.episode')" :aria-label="$t('downloads.find.episode')" inputmode="numeric" density="compact" variant="solo-filled" flat bg-color="surface-bright" :disabled="num(season) === undefined" hide-details class="find__small th-search-control" data-test="find-episode" />
        </div>
        <v-btn type="submit" color="primary" :loading="searching" :disabled="!text.trim()" data-test="find-search">{{ $t('downloads.find.search') }}</v-btn>
      </form>

      <v-alert v-if="problem" type="warning" variant="tonal" density="compact" class="mt-3">{{ problem }}</v-alert>
      <v-alert v-if="genreProblem" type="warning" variant="tonal" density="compact" class="mt-3" data-test="genre-error">
        {{ genreProblem }}
        <v-btn variant="text" size="small" :loading="genreLoading" @click="genreRetry += 1">{{ $t('common.retry') }}</v-btn>
      </v-alert>

      <div class="find__body" aria-live="polite">
        <template v-if="query">
          <div v-for="q in query" :key="q.kind" class="find__releases">
            <p v-if="query.length > 1" class="th-eyebrow">{{ $t(`downloads.suggestions.filters.${q.kind}`) }}</p>
            <ReleaseList :query="q" @back="query = null" />
          </div>
        </template>

        <template v-else-if="matches">
          <p v-if="shownMatches.length === 0" class="th-muted">{{ $t('downloads.find.noMatches') }}</p>
          <SuggestionGrid v-else :items="shownMatches" data-test="match-list" @preview="openPreview" />
          <v-btn variant="text" size="small" class="mt-2 text-wrap" data-test="match-direct" @click="openReleases(text)">{{ $t('downloads.find.direct', { title: text.trim() }) }}</v-btn>
        </template>

        <template v-else>
          <p v-if="noKey" class="th-muted">{{ $t('downloads.find.noKey') }}</p>
          <template v-else-if="hasKey">
            <SuggestionSection
              :key="`new:${suggestionFilterKey}`"
              :heading="$t('downloads.suggestions.new')"
              section="new"
              :kind="kind"
              :genres="genres"
              :genre-mode="genreMode"
              @preview="openPreview"
            />
            <SuggestionSection
              v-for="y in sectionYears"
              :key="`${y}:${suggestionFilterKey}`"
              :heading="$t('downloads.suggestions.year', { year: y })"
              section="year"
              :kind="kind"
              :genres="genres"
              :genre-mode="genreMode"
              :year="y"
              @preview="openPreview"
            />
            <v-btn variant="text" size="small" data-test="suggestion-more-years" @click="yearCount += YEARS_PER_STEP">{{ $t('downloads.suggestions.moreYears') }}</v-btn>
          </template>
        </template>
      </div>
    </section>

    <section v-if="tab === 'favorites'" :aria-label="$t('downloads.favorites.tab')" data-test="favorites-section">
      <v-btn-toggle v-model="favoriteKind" mandatory divided variant="outlined" density="compact" color="primary" class="mb-4" :aria-label="$t('downloads.suggestions.filter')" data-test="favorites-filter">
        <v-btn v-for="filter in (['all', 'movie', 'series'] as const)" :key="filter" :value="filter" :aria-pressed="favoriteKind === filter" :data-test="`favorites-filter-${filter}`">{{ $t(`downloads.suggestions.filters.${filter}`) }}</v-btn>
      </v-btn-toggle>
      <v-progress-linear v-if="favorites.loading && !favorites.loaded" indeterminate :aria-label="$t('downloads.favorites.tab')" />
      <SuggestionGrid v-if="shownFavorites.length" :items="shownFavorites" @preview="openPreview" />
      <p v-else-if="favorites.loaded" class="th-muted" data-test="favorites-empty">{{ $t(favorites.items.length ? 'downloads.favorites.noneOfKind' : 'downloads.favorites.empty') }}</p>
    </section>

    <ActiveDownloads v-show="tab === 'active'" @find="tab = 'find'" />

    <SuggestionDetailsDialog
      v-if="preview"
      v-model="previewOpen"
      :candidate="preview"
      :busy="linkAction"
      :problem="linkProblem"
      @pick="pick"
      @trailer="showTrailer"
      @imdb="showImdb"
      @closed="restorePreviewFocus"
    />
    <TrailerDialog v-if="trailerInApp && trailer" v-model="trailerOpen" :video-id="trailer.key" :title="trailer.title" @youtube="openExternal({ service: 'youtube', id: trailer.key })" />
  </div>
</template>

<style scoped>
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 4px 24px;
}
.head__tabs {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
}
.find__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-start;
}
.find__text {
  flex: 1 1 14rem;
  min-width: 0;
}
.find__kind.v-btn-toggle {
  flex: 0 0 auto;
}
.find__genre {
  flex: 1 1 24rem;
  min-width: min(100%, 18rem);
}
.find__episodes {
  display: flex;
  flex: 0 1 15rem;
  gap: 10px;
  min-width: 0;
}
.find__small {
  flex: 1 1 7rem;
  min-width: 0;
}
.find__year {
  flex: 0 1 9rem;
  min-width: 7rem;
}
/* Match the height of the fields next to it. */
.find__row > .v-btn[type='submit'] {
  align-self: flex-start;
  min-height: var(--th-control-h);
}
.find__body {
  margin-top: 16px;
}
.find__releases + .find__releases {
  margin-top: 24px;
}
@media (max-width: 700px) {
  .find__kind,
  .find__text,
  .find__genre,
  .find__episodes {
    flex-basis: 100%;
  }
  .head__tabs {
    flex-basis: 100%;
  }
}
@media (max-width: 480px) {
  .find__row {
    flex-direction: column;
    align-items: stretch;
  }
  .find__row > * {
    flex-basis: auto;
    min-width: 0;
  }
  .find__year {
    flex: none;
  }
}
</style>
