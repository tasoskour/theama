<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { mdiClose } from '@mdi/js'
import { useI18n } from 'vue-i18n'
import type { MatchCandidate, ReleaseKind } from '@theama/contracts'
import ActiveDownloads from '@/components/downloads/ActiveDownloads.vue'
import ReleaseList from '@/components/downloads/ReleaseList.vue'
import SuggestionGrid from '@/components/downloads/SuggestionGrid.vue'
import SuggestionSection from '@/components/downloads/SuggestionSection.vue'
import TrailerDialog from '@/components/titles/TrailerDialog.vue'
import { imdbLinkFor, openExternal, trailerInApp } from '@/composables/useExternalLinks'
import { useDownloadsStore } from '@/stores/downloads'
import { useMetadataStore } from '@/stores/metadata'

type Query = { kind: ReleaseKind; title: string; year?: number | undefined; season?: number | undefined; episode?: number | undefined }

const route = useRoute()
const { t } = useI18n()
const downloads = useDownloadsStore()
const metadata = useMetadataStore()

const tab = ref<'find' | 'active'>('find')
const kind = ref<ReleaseKind>('movie')
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
const query = ref<Query | null>(null)

const setUp = computed(() => downloads.client?.state !== 'not_configured' || downloads.indexer?.state !== 'not_configured')
const hasKey = computed(() => metadata.status?.configured === true)
const noKey = computed(() => metadata.status !== null && !hasKey.value)
const activeCount = computed(() => downloads.list?.items.length ?? 0)

// The suggestion sections: what is new, then this year and the years before it, five at a time.
const THIS_YEAR = new Date().getFullYear()
const YEARS_PER_STEP = 5
const yearCount = ref(YEARS_PER_STEP)
const sectionYears = computed(() => Array.from({ length: yearCount.value }, (_, i) => THIS_YEAR - i).filter((y) => y >= FIRST_YEAR))

// Trailer and IMDb link of a suggestion cost a request each, so they are fetched when the card's button is pressed.
const busy = ref<string | null>(null)
const trailer = ref<{ key: string; title: string } | null>(null)
const trailerOpen = ref(false)

async function withDetails(c: MatchCandidate, then: (d: { imdbId: string | null; trailer: { key: string } | null }) => void | Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = `${c.kind}:${c.externalId}`
  problem.value = null
  const res = await metadata.suggestionDetails(c.kind, c.externalId)
  busy.value = null
  if (!res.ok) {
    problem.value = t('downloads.suggestions.details', { message: res.message })
    return
  }
  try {
    await then(res)
  } catch (err) {
    problem.value = err instanceof Error ? err.message : String(err)
  }
}

const showTrailer = (c: MatchCandidate): Promise<void> =>
  withDetails(c, (d) => {
    if (!d.trailer) {
      problem.value = `${c.title}: ${t('downloads.suggestions.noTrailer')}`
      return
    }
    if (trailerInApp) {
      trailer.value = { key: d.trailer.key, title: c.title }
      trailerOpen.value = true
    } else return openExternal({ service: 'youtube', id: d.trailer.key })
  })

const showImdb = (c: MatchCandidate): Promise<void> =>
  withDetails(c, (d) => {
    const link = imdbLinkFor(d.imdbId)
    if (!link) {
      problem.value = `${c.title}: ${t('downloads.suggestions.noImdb')}`
      return
    }
    return openExternal(link)
  })

// Emptying the title leaves the search and shows the suggestions again.
watch(text, (v) => {
  if (v.trim()) return
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

function openReleases(title: string, y?: number): void {
  const t = title.trim()
  if (!t) return
  query.value =
    kind.value === 'movie' ? { kind: 'movie', title: t, year: y ?? year.value ?? undefined } : { kind: 'series', title: t, season: num(season.value), episode: num(season.value) === undefined ? undefined : num(episode.value) }
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
  const res = await metadata.search(kind.value, q, kind.value === 'movie' ? (year.value ?? undefined) : undefined)
  searching.value = false
  if (res.ok) matches.value = res.items
  else problem.value = res.message
}

// Suggestions mix movies and series, so the pick decides which kind of release to look for.
const pick = (c: MatchCandidate): void => {
  kind.value = c.kind
  openReleases(c.title, c.year ?? undefined)
}

function changeKind(): void {
  matches.value = null
  query.value = null
  problem.value = null
}
</script>

<template>
  <div class="th-page th-page--wide">
    <header class="th-page-header head">
      <h1 class="th-display th-page-title">{{ $t('downloads.title') }}</h1>
      <v-tabs v-model="tab" density="compact" color="primary" class="head__tabs">
        <v-tab value="find" data-test="tab-find">{{ $t('downloads.find.tab') }}</v-tab>
        <v-tab value="active" data-test="tab-active">
          {{ $t('downloads.active.heading') }}
          <v-chip v-if="activeCount > 0" size="x-small" class="ml-2" data-test="active-count">{{ activeCount }}</v-chip>
        </v-tab>
      </v-tabs>
    </header>

    <v-alert v-if="downloads.client && downloads.indexer && !setUp" type="info" variant="tonal" density="compact" class="mb-4" data-test="downloads-setup">
      {{ $t('downloads.find.setup') }}
      <router-link to="/settings/downloads">{{ $t('downloads.find.openSettings') }}</router-link>
    </v-alert>

    <section v-show="tab === 'find'" class="find">
      <form class="find__row" role="search" @submit.prevent="search">
        <v-btn-toggle v-model="kind" mandatory divided variant="outlined" density="compact" @update:model-value="changeKind">
          <v-btn value="movie" data-test="kind-movie">{{ $t('downloads.find.movie') }}</v-btn>
          <v-btn value="series" data-test="kind-series">{{ $t('downloads.find.series') }}</v-btn>
        </v-btn-toggle>
        <v-text-field
          v-model="text"
          :label="$t('downloads.find.label')"
          density="compact"
          hide-details
          clearable
          :clear-icon="mdiClose"
          :clear-label="$t('downloads.find.clear')"
          class="find__text"
          data-test="find-title"
          @click:clear="text = ''"
        />
        <v-autocomplete
          v-if="kind === 'movie'"
          v-model="year"
          :items="years"
          :label="$t('downloads.find.year')"
          density="compact"
          hide-details
          clearable
          auto-select-first
          class="find__year"
          data-test="find-year"
        />
        <template v-else>
          <v-text-field v-model="season" :label="$t('downloads.find.season')" inputmode="numeric" density="compact" hide-details class="find__small" data-test="find-season" />
          <v-text-field v-model="episode" :label="$t('downloads.find.episode')" inputmode="numeric" density="compact" :disabled="num(season) === undefined" hide-details class="find__small" data-test="find-episode" />
        </template>
        <v-btn type="submit" color="primary" :loading="searching" :disabled="!text.trim()" data-test="find-search">{{ $t('downloads.find.search') }}</v-btn>
      </form>

      <v-alert v-if="problem" type="warning" variant="tonal" density="compact" class="mt-3">{{ problem }}</v-alert>

      <div class="find__body" aria-live="polite">
        <ReleaseList v-if="query" :query="query" @back="query = null" />

        <template v-else-if="matches">
          <p v-if="matches.length === 0" class="th-muted">{{ $t('downloads.find.noMatches') }}</p>
          <SuggestionGrid v-else :items="matches" :busy="busy" data-test="match-list" @pick="pick" @trailer="showTrailer" @imdb="showImdb" />
          <v-btn variant="text" size="small" class="mt-2" data-test="match-direct" @click="openReleases(text)">{{ $t('downloads.find.direct', { title: text.trim() }) }}</v-btn>
        </template>

        <template v-else>
          <p v-if="noKey" class="th-muted">{{ $t('downloads.find.noKey') }}</p>
          <template v-else-if="hasKey">
            <SuggestionSection
              :heading="$t('downloads.suggestions.new')"
              section="new"
              :busy="busy"
              @pick="pick"
              @trailer="showTrailer"
              @imdb="showImdb"
              @problem="problem = $event"
            />
            <SuggestionSection
              v-for="y in sectionYears"
              :key="y"
              :heading="$t('downloads.suggestions.year', { year: y })"
              section="year"
              :year="y"
              :busy="busy"
              @pick="pick"
              @trailer="showTrailer"
              @imdb="showImdb"
              @problem="problem = $event"
            />
            <v-btn variant="text" size="small" data-test="suggestion-more-years" @click="yearCount += YEARS_PER_STEP">{{ $t('downloads.suggestions.moreYears') }}</v-btn>
          </template>
        </template>
      </div>
    </section>

    <ActiveDownloads v-show="tab === 'active'" @find="tab = 'find'" />

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
  flex: none;
}
.find__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.find__text {
  flex: 1 1 260px;
  min-width: 0;
}
.find__small {
  flex: 0 1 110px;
}
.find__year {
  flex: 0 1 140px;
}
.find__body {
  margin-top: 16px;
}
</style>
