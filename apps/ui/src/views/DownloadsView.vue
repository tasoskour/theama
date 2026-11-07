<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { mdiClose, mdiMagnify } from '@mdi/js'
import { useI18n } from 'vue-i18n'
import type { MatchCandidate, ReleaseKind } from '@theama/contracts'
import { MetadataPersonTitlesQuery } from '@theama/contracts'
import GenreFilter from '@/components/common/GenreFilter.vue'
import ActiveDownloads from '@/components/downloads/ActiveDownloads.vue'
import DownloadToolsPanel from '@/components/downloads/DownloadToolsPanel.vue'
import OpenToolDialog from '@/components/downloads/OpenToolDialog.vue'
import ReleaseList from '@/components/downloads/ReleaseList.vue'
import SuggestionGrid from '@/components/downloads/SuggestionGrid.vue'
import PersonSuggestions from '@/components/downloads/PersonSuggestions.vue'
import SuggestionSection from '@/components/downloads/SuggestionSection.vue'
import type { SuggestionItem } from '@/components/downloads/suggestion'
import TitlePreviewHost from '@/components/titles/TitlePreviewHost.vue'
import { useDownloadsStore } from '@/stores/downloads'
import { useDownloadsViewStore, type DownloadsPane, type ReleaseQuery } from '@/stores/downloadsView'
import { useMetadataStore } from '@/stores/metadata'
import { useFavoritesStore } from '@/stores/favorites'
import { releaseSearchFromRoute } from '@/utils/releaseSearch'
import { matchesFindFilters, searchFindYears } from '@/utils/downloadsFilters'

const route = useRoute()
const { t } = useI18n()
const downloads = useDownloadsStore()
const metadata = useMetadataStore()
const favorites = useFavoritesStore()
const view = useDownloadsViewStore()
const { tab, favoriteKind, kind, genres, genreMode, text, selectedYears, ratingRange, season, episode, matches, query, releasesMode, releaseYear, person, yearCount, searchProblem: problem } = storeToRefs(view)
const shownFavorites = computed(() => favorites.items.filter((item) => favoriteKind.value === 'all' || item.kind === favoriteKind.value))
const suggestionGenres = ref<string[]>([])
const genreProblem = ref<string | null>(null)
const genreRetry = ref(0)
const genreLoading = ref(false)
const suggestionFilterKey = computed(() => JSON.stringify([kind.value, [...selectedYears.value].sort(), [...genres.value].sort(), genres.value.length > 1 ? genreMode.value : 'any', ratingRange.value]))
const filters = computed(() => ({ kind: kind.value, years: selectedYears.value, genres: genres.value, genreMode: genreMode.value, ratingRange: ratingRange.value }))

/** Newest first: this year (and next, for what is announced) back to the first films. */
const FIRST_YEAR = 1900
const lastYear = new Date().getFullYear() + 1
const years = Array.from({ length: lastYear - FIRST_YEAR + 1 }, (_, i) => lastYear - i)

const searching = ref(false)
const shownMatches = computed(() => matches.value?.filter((c) => matchesFindFilters(c, filters.value)) ?? [])
const genreItems = computed(() => [...new Set([
  ...suggestionGenres.value,
  ...(matches.value ?? []).flatMap((c) => c.genres ?? []),
])].sort((a, b) => a.localeCompare(b)))

let searchGeneration = 0
let searchController: AbortController | undefined
let leaving = false
let mounted = false
onBeforeUnmount(() => { if (!leaving) savePlace(); leaving = true; searchGeneration += 1; searchController?.abort() })

// Releases is its own mode: a chosen title is not needed to be in it, and the mode switch shows where the user is.
const inReleases = computed(() => releasesMode.value || query.value !== null)
const findMode = computed<'suggestions' | 'releases'>({
  get: () => inReleases.value ? 'releases' : 'suggestions',
  set: (mode) => {
    if (mode === findMode.value) return
    if (mode === 'suggestions') return backFromReleases()
    releasesMode.value = true
    if (!releaseYear.value && selectedYears.value.length === 1) releaseYear.value = String(selectedYears.value[0])
    if (view.lastReleaseQuery) query.value = view.lastReleaseQuery
  },
})
const pane = computed<DownloadsPane>(() => tab.value === 'find' && inReleases.value ? 'releases' : tab.value)
let restoreGeneration = 0
function savePlace(key = pane.value): void { view.scrolls[key] = window.scrollY }
async function restorePlace(): Promise<void> {
  const mine = ++restoreGeneration
  await nextTick()
  requestAnimationFrame(() => {
    if (!leaving && mine === restoreGeneration) window.scrollTo({ top: view.scrolls[pane.value], behavior: 'instant' })
  })
}
onBeforeRouteLeave(() => { savePlace(); leaving = true; restoreGeneration++ })
watch(pane, (_next, previous) => { if (mounted && !leaving) { savePlace(previous); void restorePlace() } })
onMounted(() => { mounted = true; void restorePlace(); if (view.searchPending) void search() })

const setUp = computed(() => downloads.canFindReleases)
const hasKey = computed(() => metadata.status?.configured === true)
const noKey = computed(() => metadata.status !== null && !hasKey.value)
// Movies and series have different genre catalogs (TMDB has "Action & Adventure" for TV, but "Action" and
// "Adventure" for movies), so the choices follow the selected kind and a selection the kind lacks is dropped.
watch([hasKey, genreRetry, kind], async ([configured, , selectedKind], _previous, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  genreProblem.value = null
  genreLoading.value = configured
  if (!configured) {
    suggestionGenres.value = []
    return
  }
  const res = await metadata.genres(selectedKind === 'all' ? undefined : selectedKind)
  if (!current) return
  genreLoading.value = false
  if (res.ok) {
    suggestionGenres.value = res.genres
    const offered = new Set(genreItems.value)
    if (genres.value.some((genre) => !offered.has(genre))) genres.value = genres.value.filter((genre) => offered.has(genre))
  } else genreProblem.value = res.message
}, { immediate: true })
const activeCount = computed(() => downloads.list?.items.length ?? 0)

// The suggestion sections: what is new, then this year and the years before it, five at a time.
const THIS_YEAR = new Date().getFullYear()
const YEARS_PER_STEP = 5
const sectionYears = computed(() => selectedYears.value.length
  ? [...new Set(selectedYears.value)].sort((a, b) => b - a)
  : Array.from({ length: yearCount.value }, (_, i) => THIS_YEAR - i).filter((y) => y >= FIRST_YEAR))
const hasOlderYears = computed(() => selectedYears.value.length === 0 && THIS_YEAR - yearCount.value >= FIRST_YEAR)

// Scrolling near the end of the list adds the next few years. Observing again after each step
// asks once more if the new sections are still too short to push the sentinel out of range.
const yearsSentinel = ref<HTMLElement | null>(null)
watch(yearsSentinel, (el, _, onCleanup) => {
  if (!el) return
  const observer = new IntersectionObserver((entries) => {
    if (leaving || tab.value !== 'find' || inReleases.value || !entries.some((e) => e.isIntersecting)) return
    yearCount.value += YEARS_PER_STEP
    observer.unobserve(el)
    void nextTick(() => observer.observe(el))
  }, { rootMargin: '600px 0px' })
  observer.observe(el)
  onCleanup(() => observer.disconnect())
})

const previewHost = ref<InstanceType<typeof TitlePreviewHost> | null>(null)
function openPreview(c: SuggestionItem): void { previewHost.value?.show(c) }

// Emptying the title leaves the search and shows the suggestions again.
watch(text, (v) => {
  if (v.trim()) return
  searchGeneration += 1
  searchController?.abort()
  searching.value = false
  view.searchPending = false
  matches.value = null
  query.value = null
  problem.value = null
})

const num = (v: string): number | undefined => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** `y` of null means the year was left empty on purpose, so the Suggestions year filter is not applied behind its back. */
function openReleases(title: string, y?: number | null, selectedKind = kind.value, externalId?: string): void {
  const t = title.trim()
  if (!t) return
  const kinds: ReleaseKind[] = selectedKind === 'all' ? ['movie', 'series'] : [selectedKind]
  const next: ReleaseQuery[] = kinds.map((k) =>
    k === 'movie' ? { kind: 'movie', title: t, year: y === null ? undefined : y ?? (selectedYears.value.length === 1 ? selectedYears.value[0] : undefined), ...(externalId ? { externalId } : {}) } : { kind: 'series', title: t, season: num(season.value), episode: num(season.value) === undefined ? undefined : num(episode.value) },
  )
  if (!next.every((q) => view.releases[q.kind]?.sourceKey === JSON.stringify(q))) view.scrolls.releases = 0
  releasesMode.value = true
  view.lastReleaseQuery = next
  query.value = next
}

/** The Releases toolbar searches the torrent sites for the typed title; Suggestions asks TMDB. */
function submit(): void {
  if (releasesMode.value) openReleases(text.value, num(releaseYear.value) ?? null)
  else void search()
}

async function search(): Promise<void> {
  const q = text.value.trim()
  if (!q || searching.value) return
  problem.value = null
  matches.value = null
  query.value = null
  if (person.value) { view.searchPending = false; return }
  if (!hasKey.value) {
    view.searchPending = false
    openReleases(q)
    return
  }
  searching.value = true
  view.searchPending = true
  const mine = ++searchGeneration
  searchController?.abort()
  searchController = new AbortController()
  const kinds: ReleaseKind[] = kind.value === 'all' ? ['movie', 'series'] : [kind.value]
  const controller = searchController
  const results = await searchFindYears(kinds, selectedYears.value, (k, year) => metadata.search(k, q, year, controller.signal), controller.signal)
  if (mine !== searchGeneration) return
  searching.value = false
  view.searchPending = false
  matches.value = results.items
  problem.value = results.problem
}

// Suggestions mix movies and series, so the pick decides which kind of release to look for.
const pick = (c: MatchCandidate): void => {
  tab.value = 'find'
  openReleases(c.title, c.year ?? undefined, c.kind, c.kind === 'movie' && c.provider === 'tmdb' ? c.externalId : undefined)
}

function changeKind(): void {
  searchGeneration += 1
  searchController?.abort()
  searching.value = false
  view.searchPending = false
  matches.value = null
  query.value = null
  releasesMode.value = false
  problem.value = null
}

function backFromReleases(): void {
  query.value = null
  releasesMode.value = false
}

function leavePerson(): void {
  person.value = null
  text.value = ''
  view.scrolls.find = 0
  void restorePlace()
}

// Changing filters intentionally replaces affected results, but navigation never does.
watch([kind, selectedYears, ratingRange, genres, genreMode], () => {
  if (leaving) return
  const rerun = matches.value !== null || searching.value
  searchGeneration++
  searchController?.abort()
  searching.value = false
  view.searchPending = false
  view.suggestionPages = {}
  view.scrolls.find = 0
  if (rerun && !person.value && !inReleases.value) void search()
}, { deep: true })

// Deep links work both on arrival and when another search reuses this mounted view.
watch(() => route.query, (params) => {
  // The outgoing view can observe the next page's query before it unmounts.
  if (route.name !== 'downloads') return
  const target = releaseSearchFromRoute(params)
  const parsedPerson = MetadataPersonTitlesQuery.safeParse({ externalId: params.personId, category: params.personCategory })
  // Ordinary navigation restores the controls; explicit links start a new Find context.
  if (!target && !parsedPerson.success) return
  const contextKey = JSON.stringify(params)
  const contextPosition = window.history.state?.position as number | undefined
  if (view.contextKey === contextKey && view.contextPosition === (contextPosition ?? null)) return
  view.contextKey = contextKey
  view.contextPosition = contextPosition ?? null
  changeKind()
  previewHost.value?.close()
  person.value = parsedPerson.success ? { ...parsedPerson.data, name: typeof params.personName === 'string' ? params.personName : t(parsedPerson.data.category === 'actor' ? 'detail.actor' : 'detail.director') } : null
  tab.value = 'find'
  kind.value = 'all'
  genres.value = []
  genreMode.value = 'any'
  text.value = ''
  selectedYears.value = []
  ratingRange.value = [0, 10]
  season.value = ''
  episode.value = ''
  view.suggestionPages = {}
  view.personResults = {}
  view.releases = {}
  view.lastReleaseQuery = null
  releaseYear.value = ''
  view.scrolls.find = 0
  view.scrolls.releases = 0
  if (!target) return
  kind.value = target.kind
  text.value = target.title
  selectedYears.value = target.year === undefined ? [] : [target.year]
  season.value = target.season === undefined ? '' : String(target.season)
  episode.value = target.episode === undefined ? '' : String(target.episode)
  if (params.releases === '1') {
    releasesMode.value = true
    view.lastReleaseQuery = [target]
    query.value = [target]
  } else void search()
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

    <section v-if="tab === 'find'" class="find">
      <!-- Always visible, so it is clear which of the two views is open and how to reach the other. -->
      <v-btn-toggle v-model="findMode" mandatory divided variant="outlined" density="compact" color="primary" class="find__mode th-toggle-control" :aria-label="$t('downloads.find.mode.label')" data-test="find-mode">
        <v-btn v-for="mode in (['suggestions', 'releases'] as const)" :key="mode" :value="mode" :aria-pressed="findMode === mode" :data-test="`find-mode-${mode}`">
          {{ $t(`downloads.find.mode.${mode}`) }}
        </v-btn>
      </v-btn-toggle>

      <!-- A chosen title brings its own title and filters in the releases list; this bar would only drop the user out of them. -->
      <form v-if="!query" class="find__row" role="search" @submit.prevent="submit">
        <v-btn-toggle v-model="kind" mandatory divided variant="outlined" density="compact" color="primary" class="find__kind th-toggle-control" :aria-label="$t('downloads.suggestions.filter')" data-test="suggestion-filter">
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
        <div class="find__filters">
          <GenreFilter
            v-if="hasKey && !releasesMode"
            v-model="genres"
            v-model:mode="genreMode"
            :items="genreItems"
            flush
            class="find__genre"
            data-test="find-genre"
          />
          <v-text-field
            v-if="releasesMode && kind !== 'series'"
            v-model="releaseYear"
            :placeholder="$t('downloads.find.year')"
            :aria-label="$t('downloads.find.year')"
            inputmode="numeric"
            density="compact"
            variant="solo-filled"
            flat
            bg-color="surface-bright"
            hide-details
            class="find__small th-search-control"
            data-test="find-release-year"
          />
          <v-autocomplete
            v-else-if="!releasesMode"
            v-model="selectedYears"
            :items="years"
            :placeholder="$t('downloads.find.years')"
            :aria-label="$t('downloads.find.years')"
            multiple
            chips
            closable-chips
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
          <div v-if="hasKey && !releasesMode" class="find__rating" data-test="find-rating">
            <div class="find__rating-label">
              <span>{{ $t('downloads.find.rating') }}: {{ ratingRange[0].toFixed(1) }}–{{ ratingRange[1].toFixed(1) }}</span>
              <v-btn variant="text" size="x-small" :disabled="ratingRange[0] === 0 && ratingRange[1] === 10" data-test="find-rating-reset" @click="ratingRange = [0, 10]">{{ $t('downloads.find.resetRating') }}</v-btn>
            </div>
            <v-range-slider v-model="ratingRange" :min="0" :max="10" :step="0.1" strict hide-details density="compact" thumb-label :aria-label="$t('downloads.find.rating')" />
          </div>
          <div v-if="kind === 'series'" class="find__episodes">
            <v-text-field v-model="season" :placeholder="$t('downloads.find.season')" :aria-label="$t('downloads.find.season')" inputmode="numeric" density="compact" variant="solo-filled" flat bg-color="surface-bright" hide-details class="find__small th-search-control" data-test="find-season" />
            <v-text-field v-model="episode" :placeholder="$t('downloads.find.episode')" :aria-label="$t('downloads.find.episode')" inputmode="numeric" density="compact" variant="solo-filled" flat bg-color="surface-bright" :disabled="num(season) === undefined" hide-details class="find__small th-search-control" data-test="find-episode" />
          </div>
        </div>
        <v-btn type="submit" color="primary" :loading="searching" :disabled="!text.trim()" data-test="find-search">{{ $t(releasesMode ? 'downloads.releases.search' : 'downloads.find.search') }}</v-btn>
      </form>

      <v-alert v-if="problem && !inReleases" type="warning" variant="tonal" density="compact" class="mt-3">{{ problem }}</v-alert>
      <v-alert v-if="genreProblem && !inReleases"type="warning" variant="tonal" density="compact" class="mt-3" data-test="genre-error">
        {{ genreProblem }}
        <v-btn variant="text" size="small" :loading="genreLoading" @click="genreRetry += 1">{{ $t('common.retry') }}</v-btn>
      </v-alert>

      <div class="find__body" aria-live="polite">
        <template v-if="query">
          <div v-for="q in query" :key="JSON.stringify(q)" class="find__releases">
            <p v-if="query.length > 1" class="th-eyebrow">{{ $t(`downloads.suggestions.filters.${q.kind}`) }}</p>
            <ReleaseList :query="q" @back="backFromReleases" />
          </div>
        </template>

        <p v-else-if="releasesMode" class="th-muted" data-test="find-releases-hint">{{ $t('downloads.find.releasesHint') }}</p>

        <PersonSuggestions v-else-if="person" v-bind="person" :kind="kind" :genres="genres" :genre-mode="genreMode" :query="text" :years="selectedYears" :rating-range="ratingRange" @preview="openPreview" @back="leavePerson" />

        <template v-else-if="matches">
          <p v-if="shownMatches.length === 0" class="th-muted">{{ $t('downloads.find.noMatches') }}</p>
          <SuggestionGrid v-else :items="shownMatches" data-test="match-list" @preview="openPreview" />
          <v-btn variant="text" size="small" class="mt-2 text-wrap" data-test="match-direct" @click="openReleases(text)">{{ $t('downloads.find.direct', { title: text.trim() }) }}</v-btn>
        </template>

        <template v-else>
          <p v-if="noKey" class="th-muted">{{ $t('downloads.find.noKey') }}</p>
          <template v-else-if="hasKey">
            <SuggestionSection
              v-if="selectedYears.length === 0"
              :key="`new:${suggestionFilterKey}`"
              :heading="$t('downloads.suggestions.new')"
              section="new"
              :kind="kind"
              :genres="genres"
              :genre-mode="genreMode"
              :rating-range="ratingRange"
              :show-empty="ratingRange[0] > 0 || ratingRange[1] < 10"
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
              :rating-range="ratingRange"
              :show-empty="selectedYears.length > 0 || ratingRange[0] > 0 || ratingRange[1] < 10"
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

    <TitlePreviewHost ref="previewHost" focus-fallback=".head__tabs [role='tab'][aria-selected='true']" @pick="pick" />
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
.find__mode.v-btn-toggle {
  margin-bottom: 12px;
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
.find__filters { display: flex; flex: 1 0 100%; order: 2; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.find__filters > :first-child { padding-inline-start: 0; background: none; }
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
.find__rating,
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
  flex: 0 1 14rem;
  min-width: 9rem;
}
.find__rating { flex: 1 1 15rem; min-width: min(100%, 13rem); padding-inline: 12px; }
.find__rating-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.8rem; }
.find__rating :deep(.v-input__control) { min-height: 24px; }
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
  order: 1;
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
  .find__rating,
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
  .find__filters { flex-direction: column; align-items: stretch; }
  .find__filters > * { flex-basis: auto; min-width: 0; }
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
