<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { mdiHistory, mdiMagnify } from '@mdi/js'
import type { TitleKind, TitleSummary } from '@theama/contracts'
import PosterGrid from '@/components/titles/PosterGrid.vue'
import CollectionCard from '@/components/collections/CollectionCard.vue'
import { useCollections } from '@/composables/useCollections'
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
const input = ref<{ $el: HTMLElement } | null>(null)

const searching = computed(() => text.value.trim().length > 0)
// Up to 200 matches in one page: a search is a short list, not a library to scroll through.
const list = useTitles({ kind: () => (searching.value ? undefined : null), limit: 200, q: text })
const { items, total, loaded, loading } = list
const foundCollections = useCollections(() => (searching.value ? text.value.trim() : null))

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

watch(input, (el) => el?.$el.querySelector('input')?.focus(), { once: true })
</script>

<template>
  <div class="th-page">
    <header class="mb-6">
      <p class="th-eyebrow mb-2">{{ $t('app.tagline') }}</p>
      <h1 class="th-display page-title">{{ $t('nav.search') }}</h1>
    </header>

    <v-text-field
      ref="input"
      v-model="text"
      :prepend-inner-icon="mdiMagnify"
      :label="$t('search.label')"
      :hint="$t('search.hint')"
      persistent-hint
      clearable
      autofocus
      class="field"
      @keydown.down.prevent="toResults"
    />

    <section v-if="!searching" class="start">
      <template v-if="recent.length > 0">
        <div class="start__head">
          <h2 class="th-eyebrow">{{ $t('search.recent') }}</h2>
          <v-btn variant="text" size="small" @click="clearRecent">{{ $t('search.clear') }}</v-btn>
        </div>
        <ul class="recent" role="list">
          <li v-for="r in recent" :key="r">
            <v-chip :prepend-icon="mdiHistory" label variant="outlined" @click="text = r">{{ r }}</v-chip>
          </li>
        </ul>
      </template>
      <p v-else class="th-muted">{{ $t('empty.search.body') }}</p>
    </section>

    <template v-else>
      <p class="th-muted mb-2" aria-live="polite">{{ loading && !loaded ? $t('common.loading') : $t('titles.count', total) }}</p>
      <p v-if="loaded && !loading && total === 0 && foundCollections.items.value.length === 0" class="none th-muted">{{ $t('titles.noMatches') }}</p>
      <section v-if="foundCollections.items.value.length > 0" class="group" data-test="collection-results">
        <h2 class="th-display group__title">{{ $t('nav.collections') }}</h2>
        <ul class="found" role="list" :aria-label="$t('nav.collections')" @keydown="moveBetweenCards($event, '[data-collection-id]')">
          <li v-for="c in foundCollections.items.value" :key="c.id"><CollectionCard :collection="c" /></li>
        </ul>
      </section>
      <section v-for="g in groups" :key="g.kind" class="group">
        <h2 class="th-display group__title">{{ $t(g.labelKey) }}</h2>
        <PosterGrid :titles="g.titles" :label="$t(g.labelKey)" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-title {
  font-size: clamp(2rem, 4vw, 3rem);
  margin: 0;
}
.field {
  max-width: 640px;
  margin-bottom: 16px;
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
  grid-template-columns: repeat(auto-fill, minmax(clamp(130px, 13vw, 180px), 1fr));
  gap: 28px 18px;
}
.group {
  margin-top: 24px;
}
.group__title {
  font-size: 1.35rem;
  margin: 0 0 4px;
}
.none {
  padding: 32px 0;
}
</style>
