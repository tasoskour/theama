<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { mdiClose, mdiMagnify } from '@mdi/js'
import { useI18n } from 'vue-i18n'
import type { MatchCandidate, ReleaseKind, Suggestion } from '@theama/contracts'
import { MetadataPersonTitlesQuery } from '@theama/contracts'
import GenreFilter from '@/components/common/GenreFilter.vue'
import ActiveDownloads from '@/components/downloads/ActiveDownloads.vue'
import DownloadToolsPanel from '@/components/downloads/DownloadToolsPanel.vue'
import OpenToolDialog from '@/components/downloads/OpenToolDialog.vue'
import ReleaseList from '@/components/downloads/ReleaseList.vue'
import SuggestionGrid from '@/components/downloads/SuggestionGrid.vue'
import PersonSuggestions from '@/components/downloads/PersonSuggestions.vue'
import SuggestionSection from '@/components/downloads/SuggestionSection.vue'
import SuggestionDetailsDialog from '@/components/downloads/SuggestionDetailsDialog.vue'
import type { SuggestionItem } from '@/components/downloads/suggestion'
import TrailerDialog from '@/components/titles/TrailerDialog.vue'
import { imdbLinkFor, openExternal, trailerInApp } from '@/composables/useExternalLinks'
import { useDownloadsStore } from '@/stores/downloads'
import { useDownloadsViewStore } from '@/stores/downloadsView'
import { useMetadataStore } from '@/stores/metadata'
import { useFavoritesStore } from '@/stores/favorites'
import { releaseSearchFromRoute } from '@/utils/releaseSearch'

type Query = { kind: ReleaseKind; title: string; year?: number | undefined; season?: number | undefined; episode?: number | undefined }

const route = useRoute()
const { t } = useI18n()
const downloads = useDownloadsStore()
const metadata = useMetadataStore()
const favorites = useFavoritesStore()
const person = computed(() => {
  const parsed = MetadataPersonTitlesQuery.safeParse({ externalId: route.query.personId, category: route.query.personCategory })
  if (!parsed.success) return null
  return { ...parsed.data, name: typeof route.query.personName === 'string' ? route.query.personName : t(parsed.data.category === 'actor' ? 'detail.actor' : 'detail.director') }
})

const { tab, favoriteKind, kind, genres, genreMode, text, year, season, episode } = storeToRefs(useDownloadsViewStore())
const shownFavorites = computed(() => favorites.items.filter((item) => favoriteKind.value === 'all' || item.kind === favoriteKind.value))
const suggestionGenres = ref<string[]>([])
const genreProblem = ref<string | null>(null)
const genreRetry = ref(0)
const genreLoading = ref(false)
const suggestionFilterKey = computed(() => JSON.stringify([[...genres.value].sort(), genres.value.length > 1 ? genreMode.value : 'any']))

/** Newest first: this year (and next, for what is announced) back to the first films. */
const FIRST_YEAR = 1900
const lastYear = new Date().getFullYear() + 1
const years = Array.from({ length: lastYear - FIRST_YEAR + 1 }, (_, i) => lastYear - i)

const searching = ref(false)
const matches = ref<Suggestion[] | null>(null)
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
let searchController: AbortController | undefined
onBeforeUnmount(() => { searchGeneration += 1; searchController?.abort() })

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
const hasOlderYears = computed(() => THIS_YEAR - yearCount.value >= FIRST_YEAR)

// Scrolling near the end of the list adds the next few years. Observing again after each step
// asks once more if the new sections are still too short to push the sentinel out of range.
const yearsSentinel = ref<HTMLElement | null>(null)
watch(yearsSentinel, (el, _, onCleanup) => {
  if (!el) return
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    yearCount.value += YEARS_PER_STEP
    observer.unobserve(el)
    void nextTick(() => observer.observe(el))
  }, { rootMargin: '600px 0px' })
  observer.observe(el)
  onCleanup(() => observer.disconnect())
})

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
  searchController?.abort()
  searching.value = false
  matches.value = null
  query.value = null
  problem.value = null
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
  if (person.value) return
  if (!hasKey.value) {
    openReleases(q)
    return
  }
  searching.value = true
  const mine = ++searchGeneration
  searchController?.abort()
  searchController = new AbortController()
  const kinds: ReleaseKind[] = kind.value === 'all' ? ['movie', 'series'] : [kind.value]
  const results = await Promise.all(kinds.map((k) => metadata.search(k, q, k === 'movie' ? (year.value ?? undefined) : undefined, searchController!.signal)))
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
  searchController?.abort()
  searching.value = false
  matches.value = null
  query.value = null
  problem.value = null
}

function backFromReleases(): void {
  query.value = null
  if (person.value) {
    text.value = ''
    year.value = null
  }
}

// Deep links work both on arrival and when another search reuses this mounted view.
watch(() => route.query, (params) => {
  // The outgoing view can observe the next page's query before it unmounts.
  if (route.name !== 'downloads') return
  changeKind()
  previewOpen.value = false
  trailerOpen.value = false
  const target = releaseSearchFromRoute(params)
  // Ordinary navigation restores the controls; explicit links start a new Find context.
  if (!target && !person.value) return
  tab.value = 'find'
  kind.value = 'all'
  genres.value = []
  genreMode.value = 'any'
  text.value = ''
  year.value = null
  season.value = ''
  episode.value = ''
  if (!target) return
  kind.value = target.kind
  text.value = target.title
  year.value = target.year ?? null
  season.value = target.season === undefined ? '' : String(target.season)
  episode.value = target.episode === undefined ? '' : String(target.episode)
  if (params.releases === '1') query.value = [target]
  else void search()
}, { immediate: true })
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
    <OpenToolDialog />

    <v-alert v-if="favorites.error" type="warning" variant="tonal" class="mb-4" data-test="favorites-error">
      {{ $t('downloads.favorites.error', { message: favorites.error }) }}
      <v-btn variant="text" size="small" data-test="favorites-retry" @click="favorites.retry()">{{ $t('downloads.favorites.retry') }}</v-btn>
    </v-alert>

    <v-alert v-if="downloads.client && downloads.indexer && !setUp" type="info" variant="tonal" density="compact" class="mb-4" data-test="downloads-setup">
      {{ $t('downloads.find.setup') }}
      <router-link to="/settings/downloads">{{ $t('downloads.find.openSettings') }}</router-link>
    </v-alert>

    <section v-show="tab === 'find'" class="find">
      <!-- Releases bring their own title and filters; this bar would only drop the user out of them. -->
      <form v-if="!query" class="find__row" role="search" @submit.prevent="search">
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
          :prepend-inner-icon="mdiMagnify"
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
          flush
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

      <v-alert v-if="problem && !query" type="warning" variant="tonal" density="compact" class="mt-3">{{ problem }}</v-alert>
      <v-alert v-if="genreProblem && !query" type="warning" variant="tonal" density="compact" class="mt-3" data-test="genre-error">
        {{ genreProblem }}
        <v-btn variant="text" size="small" :loading="genreLoading" @click="genreRetry += 1">{{ $t('common.retry') }}</v-btn>
      </v-alert>

      <div class="find__body" aria-live="polite">
        <template v-if="query">
          <div v-for="q in query" :key="q.kind" class="find__releases">
            <p v-if="query.length > 1" class="th-eyebrow">{{ $t(`downloads.suggestions.filters.${q.kind}`) }}</p>
            <ReleaseList :query="q" @back="backFromReleases" />
          </div>
        </template>

        <PersonSuggestions v-else-if="person" v-bind="person" :kind="kind" :genres="genres" :genre-mode="genreMode" :query="text" :year="year" @preview="openPreview" />

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
            <div v-if="hasOlderYears" ref="yearsSentinel" class="years-sentinel" aria-hidden="true" data-test="suggestion-years-sentinel" />
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
.years-sentinel {
  height: 1px;
}
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
/* One bordered toolbar: borderless controls separated by short dividers, Search is the only filled element. */
.find__row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 4px;
  border: var(--th-border);
  border-radius: calc(var(--th-radius) + 4px);
  background: rgba(var(--v-theme-surface), 0.84);
  transition: border-color var(--th-motion);
}
.find__row:focus-within {
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.find__kind.v-btn-toggle {
  flex: 0 0 auto;
  padding: 0 7px 0 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: linear-gradient(rgba(var(--v-theme-hairline), 0.9), rgba(var(--v-theme-hairline), 0.9)) right center / 1px 55% no-repeat;
}
.find__kind :deep(.v-btn) {
  min-width: 0;
  padding-inline: 0.7rem;
  border-radius: var(--th-radius) !important;
  color: rgb(var(--v-theme-on-surface-variant));
}
.find__text {
  flex: 1 1 10rem;
  min-width: 0;
}
.find__genre,
.find__year,
.find__episodes {
  padding-inline-start: 7px;
  background: linear-gradient(rgba(var(--v-theme-hairline), 0.9), rgba(var(--v-theme-hairline), 0.9)) left center / 1px 55% no-repeat;
}
.find__genre {
  flex: 0 1 18rem;
  min-width: min(100%, 14rem);
}
.find__episodes {
  display: flex;
  flex: 0 1 11rem;
  gap: 4px;
  min-width: 0;
}
.find__small {
  flex: 1 1 5.5rem;
  min-width: 0;
}
.find__year {
  flex: 0 1 8rem;
  min-width: 6.5rem;
}
/* The toolbar draws the border; fields inside only show a soft fill on hover and focus. */
.find__row :deep(.th-search-control .v-field) {
  background: transparent !important;
  box-shadow: none;
  border-radius: var(--th-radius);
}
.find__row :deep(.th-search-control .v-field:hover),
.find__row :deep(.th-search-control:focus-within .v-field) {
  background: rgb(var(--v-theme-surface-light)) !important;
  box-shadow: none;
}
/* Match the height of the fields next to it. */
.find__row > .v-btn[type='submit'] {
  flex: 0 0 auto;
  min-height: var(--th-control-h);
  border-radius: var(--th-radius);
}
.find__body {
  margin-top: 16px;
}
.find__releases + .find__releases {
  margin-top: 24px;
}
@media (max-width: 62rem) {
  .find__row {
    row-gap: 4px;
  }
  .find__kind.v-btn-toggle {
    padding: 0 !important;
    background: none;
  }
  .find__text {
    flex-basis: 100%;
  }
  .find__genre,
  .find__year,
  .find__episodes {
    padding-inline-start: 0;
    background: none;
  }
}
@media (max-width: 700px) {
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
  .find__kind.v-btn-toggle {
    max-width: 100%;
  }
  .find__genre.genre-filter--flush {
    flex-wrap: wrap;
  }
  .find__kind :deep(.v-btn) {
    flex: 1 1 0;
    min-width: 0;
    padding-inline: 0.3rem;
  }
  .find__year {
    flex: none;
  }
}
</style>
