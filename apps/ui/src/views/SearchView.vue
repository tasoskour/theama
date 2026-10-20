<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { mdiHistory } from '@mdi/js'
import type { TitleKind, TitleSummary } from '@theama/contracts'
import PosterGrid from '@/components/titles/PosterGrid.vue'
import GenreFilter from '@/components/common/GenreFilter.vue'
import SearchField from '@/components/common/SearchField.vue'
import CollectionCard from '@/components/collections/CollectionCard.vue'
import { useCollections } from '@/composables/useCollections'
import { useGenres } from '@/composables/useGenres'
import { useTitles } from '@/composables/useTitles'
import { moveBetweenCards } from '@/utils/gridNav'

const RECENT_KEY = 'theama.recentSearches'
const MAX_RECENT = 8

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}
function writeRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // Storage may be unavailable; recents are a convenience only.
  }
}

const text = ref('')
const recent = ref<string[]>(readRecent())
const input = ref<{ focus: () => void } | null>(null)

const genres = ref<string[]>([])
const { genres: genreItems } = useGenres(() => undefined)

const hasText = computed(() => text.value.trim().length > 0)
// Picking genres alone is a search too: it lists everything of those genres.
const searching = computed(() => hasText.value || genres.value.length > 0)
// Up to 200 matches in one page: a search is a short list, not a library to scroll through.
const list = useTitles({ kind: () => (searching.value ? undefined : null), limit: 200, q: text, genres })
const { items, total, loaded, loading } = list
const foundCollections = useCollections(() => (hasText.value ? text.value.trim() : null))

const SECTIONS: { kind: TitleKind; labelKey: string }[] = [
  { kind: 'movie', labelKey: 'nav.movies' },
  { kind: 'series', labelKey: 'nav.series' },
  { kind: 'video', labelKey: 'nav.videos' },
]
const groups = computed(() =>
  SECTIONS.map((s) => ({ ...s, titles: items.value.filter((t: TitleSummary) => t.kind === s.kind) })).filter((g) => g.titles.length > 0),
)

// Remember a query once it has produced results and the user stopped typing.
let remember: ReturnType<typeof setTimeout> | undefined
watch([text, total, loaded], () => {
  clearTimeout(remember)
  const q = text.value.trim()
  if (q.length < 2 || total.value === 0) return
  remember = setTimeout(() => {
    recent.value = [q, ...recent.value.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT)
    writeRecent(recent.value)
  }, 1500)
})

function clearRecent(): void {
  recent.value = []
  writeRecent([])
}

/** Arrow Down from the field jumps into the first result, like a menu. */
async function toResults(): Promise<void> {
  await nextTick()
  document.querySelector<HTMLElement>('[data-title-key]')?.focus()
}

watch(input, (el) => el?.focus(), { once: true })
</script>

<template>
  <div class="th-page th-page--wide">
    <header class="th-page-header">
      <p class="th-eyebrow mb-2">{{ $t('app.tagline') }}</p>
      <h1 class="th-display th-page-title">{{ $t('nav.search') }}</h1>
    </header>

    <div class="search-panel" role="search">
      <div class="search-row">
        <SearchField
          ref="input"
          v-model="text"
          :aria-label="$t('search.label')"
          :placeholder="$t('search.label')"
          autofocus
          class="field"
          :loading="loading && searching"
          @keydown.down.prevent="toResults"
        />
        <GenreFilter v-model="genres" :items="genreItems" class="genres" />
      </div>
      <p class="search-help th-muted">{{ $t('search.hint') }}</p>
    </div>

    <section v-if="!searching" class="start">
      <template v-if="recent.length > 0">
        <div class="start__head">
          <h2 class="th-eyebrow">{{ $t('search.recent') }}</h2>
          <v-btn variant="text" size="small" @click="clearRecent">{{ $t('search.clear') }}</v-btn>
        </div>
        <ul class="recent" role="list">
          <li v-for="r in recent" :key="r">
            <v-chip :prepend-icon="mdiHistory" label variant="tonal" @click="text = r">{{ r }}</v-chip>
          </li>
        </ul>
      </template>
      <p v-else class="th-muted">{{ $t('empty.search.body') }}</p>
    </section>

    <template v-else>
      <p class="results-summary th-muted" aria-live="polite">{{ loading && !loaded ? $t('common.loading') : $t('titles.count', total) }}</p>
      <p v-if="loaded && !loading && total === 0 && foundCollections.items.value.length === 0" class="none th-muted">{{ $t('titles.noMatches') }}</p>
      <section v-if="foundCollections.items.value.length > 0" class="group th-results-enter" data-test="collection-results">
        <h2 class="th-display group__title">{{ $t('nav.collections') }}</h2>
        <ul class="found" role="list" :aria-label="$t('nav.collections')" @keydown="moveBetweenCards($event, '[data-collection-id]')">
          <li v-for="c in foundCollections.items.value" :key="c.id"><CollectionCard :collection="c" /></li>
        </ul>
      </section>
      <section v-for="g in groups" :key="g.kind" class="group th-results-enter">
        <h2 class="th-display group__title">{{ $t(g.labelKey) }}</h2>
        <PosterGrid :titles="g.titles" :label="$t(g.labelKey)" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.th-page-header {
  display: block;
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.field {
  flex: 1 1 320px;
  min-width: 0;
}
.genres {
  flex: 0 1 280px;
  min-width: 200px;
}
.search-panel {
  max-width: 800px;
  margin-bottom: 20px;
}
.search-help {
  max-width: 68ch;
  margin: 8px 4px 0;
  font-size: 0.85rem;
  line-height: 1.45;
}
.start__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 640px;
}
.recent {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.found {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 28px 20px;
}
.group {
  margin-top: 28px;
}
.group__title {
  font-size: 1.35rem;
  margin: 0 0 8px;
}
.results-summary {
  margin: 0 0 8px 4px;
  font-size: 0.86rem;
}
.none {
  padding: 32px 0;
}
@media (min-width: 1500px) {
  .found {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}
@media (max-width: 600px) {
  .found {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 20px 14px;
  }
}
</style>
