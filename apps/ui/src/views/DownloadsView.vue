<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { MatchCandidate, ReleaseKind } from '@theama/contracts'
import ActiveDownloads from '@/components/downloads/ActiveDownloads.vue'
import ReleaseDialog from '@/components/downloads/ReleaseDialog.vue'
import { useDownloadsStore } from '@/stores/downloads'
import { useMetadataStore } from '@/stores/metadata'

type Query = { kind: ReleaseKind; title: string; year?: number | undefined; season?: number | undefined; episode?: number | undefined }

const route = useRoute()
const downloads = useDownloadsStore()
const metadata = useMetadataStore()

const kind = ref<ReleaseKind>('movie')
const text = ref('')
const year = ref('')
const season = ref('')
const episode = ref('')

const searching = ref(false)
const candidates = ref<MatchCandidate[] | null>(null)
const problem = ref<string | null>(null)

const dialogOpen = ref(false)
const dialogQuery = ref<Query | null>(null)

const setUp = computed(() => downloads.client?.state !== 'not_configured' || downloads.indexer?.state !== 'not_configured')
const hasKey = computed(() => metadata.status?.configured === true)

// Arriving from a title page ("Find a download…") fills the form in and searches straight away.
onMounted(() => {
  void downloads.load()
  const { kind: k, title, year: y } = route.query
  if ((k === 'movie' || k === 'series') && typeof title === 'string' && title.trim()) {
    kind.value = k
    text.value = title
    if (typeof y === 'string' && k === 'movie') year.value = y
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
  dialogQuery.value =
    kind.value === 'movie' ? { kind: 'movie', title: t, year: y ?? num(year.value) } : { kind: 'series', title: t, season: num(season.value), episode: num(season.value) === undefined ? undefined : num(episode.value) }
  dialogOpen.value = true
}

async function search(): Promise<void> {
  const q = text.value.trim()
  if (!q || searching.value) return
  problem.value = null
  candidates.value = null
  if (!hasKey.value) {
    openReleases(q)
    return
  }
  searching.value = true
  const res = await metadata.search(kind.value, q, kind.value === 'movie' ? num(year.value) : undefined)
  searching.value = false
  if (res.ok) candidates.value = res.items
  else problem.value = res.message
}

function changeKind(): void {
  candidates.value = null
  problem.value = null
}
</script>

<template>
  <div class="th-page">
    <header class="th-page-header">
      <h1 class="th-display th-page-title">{{ $t('downloads.title') }}</h1>
    </header>

    <v-alert v-if="downloads.client && downloads.indexer && !setUp" type="info" variant="tonal" density="compact" class="mb-6" data-test="downloads-setup">
      {{ $t('downloads.find.setup') }}
      <router-link to="/settings/downloads">{{ $t('downloads.find.openSettings') }}</router-link>
    </v-alert>

    <ActiveDownloads />

    <section class="find" aria-labelledby="find-heading">
      <h2 id="find-heading" class="th-display find__title">{{ $t('downloads.find.heading') }}</h2>
      <p class="th-muted find__intro">{{ $t('downloads.find.intro') }}</p>

      <form class="find__form" role="search" @submit.prevent="search">
        <v-btn-toggle v-model="kind" mandatory divided variant="outlined" density="comfortable" @update:model-value="changeKind">
          <v-btn value="movie" data-test="kind-movie">{{ $t('downloads.find.movie') }}</v-btn>
          <v-btn value="series" data-test="kind-series">{{ $t('downloads.find.series') }}</v-btn>
        </v-btn-toggle>
        <div class="find__row">
          <v-text-field v-model="text" :label="$t('downloads.find.label')" autofocus hide-details class="find__text" data-test="find-title" />
          <v-text-field v-if="kind === 'movie'" v-model="year" :label="$t('downloads.find.year')" inputmode="numeric" hide-details class="find__small" data-test="find-year" />
          <template v-else>
            <v-text-field v-model="season" :label="$t('downloads.find.season')" inputmode="numeric" hide-details class="find__small" data-test="find-season" />
            <v-text-field v-model="episode" :label="$t('downloads.find.episode')" inputmode="numeric" :disabled="num(season) === undefined" hide-details class="find__small" data-test="find-episode" />
          </template>
          <v-btn type="submit" color="primary" size="large" :loading="searching" :disabled="!text.trim()" data-test="find-search">{{ $t('downloads.find.search') }}</v-btn>
        </div>
      </form>
      <p v-if="!hasKey" class="th-muted find__hint">{{ $t('downloads.find.noKey') }}</p>
      <v-alert v-if="problem" type="warning" variant="tonal" density="compact" class="mt-4">{{ problem }}</v-alert>

      <div v-if="candidates" class="matches" aria-live="polite">
        <h3 class="th-eyebrow">{{ $t('downloads.find.matches') }}</h3>
        <p v-if="candidates.length === 0" class="th-muted">{{ $t('downloads.find.noMatches') }}</p>
        <ul v-else class="match-list" role="list" data-test="match-list">
          <li v-for="c in candidates" :key="c.externalId" class="match">
            <div class="match__main">
              <span class="match__title">{{ c.title }}<span v-if="c.year" class="th-muted"> ({{ c.year }})</span></span>
              <span v-if="c.overview" class="th-muted match__overview">{{ c.overview }}</span>
            </div>
            <v-btn variant="tonal" size="small" data-test="match-find" @click="openReleases(c.title, c.year ?? undefined)">{{ $t('downloads.find.findReleases') }}</v-btn>
          </li>
        </ul>
        <v-btn variant="text" size="small" class="mt-2" @click="openReleases(text)">{{ $t('downloads.find.direct', { title: text.trim() }) }}</v-btn>
      </div>
    </section>

    <ReleaseDialog v-model="dialogOpen" :query="dialogQuery" />
  </div>
</template>

<style scoped>
.find {
  max-width: 820px;
}
.find__title {
  font-size: 1.35rem;
  margin: 0 0 4px;
}
.find__intro,
.find__hint {
  margin: 0 0 16px;
  max-width: 62ch;
  font-size: 0.9rem;
}
.find__form {
  display: grid;
  gap: 12px;
}
.find__row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.find__text {
  flex: 1 1 280px;
  min-width: 0;
}
.find__small {
  flex: 0 1 110px;
}
.matches {
  margin-top: 24px;
}
.match-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.match {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(var(--v-theme-hairline), 0.72);
}
.match__main {
  display: grid;
  min-width: 0;
}
.match__title {
  font-weight: 600;
}
.match__overview {
  font-size: 0.85rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
