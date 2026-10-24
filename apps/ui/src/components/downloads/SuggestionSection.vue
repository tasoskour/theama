<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { GenreMode, MatchKind, Suggestion, SuggestionSection } from '@theama/contracts'
import { useMetadataStore } from '@/stores/metadata'
import SuggestionGrid from './SuggestionGrid.vue'
import type { SuggestionItem } from './suggestion'

const props = defineProps<{ heading: string; section: SuggestionSection; kind?: MatchKind | 'all'; genres: string[]; genreMode: GenreMode; year?: number }>()
const emit = defineEmits<{ preview: [candidate: SuggestionItem] }>()

const metadata = useMetadataStore()

const items = ref<Suggestion[]>([])
const page = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loaded = ref(false)
const problem = ref<string | null>(null)
let active = true
const shown = computed(() => items.value.filter((c) =>
  !props.kind || props.kind === 'all' || c.kind === props.kind,
))

/** One page at a time; a second click while a page is on its way does nothing. */
async function loadNext(): Promise<void> {
  if (!active || loading.value) return
  loading.value = true
  problem.value = null
  const res = await metadata.suggestions(props.section, props.year, page.value + 1, props.genres, props.genreMode)
  // Filter changes remount this section. An old response must not update the new results or errors.
  if (!active) return
  loading.value = false
  loaded.value = true
  if (!res.ok) {
    problem.value = res.message
    return
  }
  page.value += 1
  const known = new Set(items.value.map((c) => c.externalId + c.kind))
  items.value = [...items.value, ...res.items.filter((c) => {
    const key = c.externalId + c.kind
    if (known.has(key)) return false
    known.add(key)
    return true
  })]
  hasMore.value = res.hasMore
}

// Several sections stack up the page; each only asks for its titles once it is about to be seen.
const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer?.disconnect()
      void loadNext()
    },
    { rootMargin: '600px 0px' },
  )
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => {
  active = false
  observer?.disconnect()
})
</script>

<template>
  <section v-if="!loaded || items.length > 0 || genres.length > 0 || problem" ref="root" class="sugg" :aria-label="heading" data-test="suggestion-section">
    <h2 class="sugg__heading th-display">{{ heading }}</h2>
    <v-progress-linear v-if="loading && items.length === 0" indeterminate height="2" :aria-label="heading" />
    <div v-else-if="!loaded" class="sugg__wait" aria-hidden="true" />
    <v-alert v-if="problem" type="warning" variant="tonal" density="compact" class="mt-3" data-test="suggestion-error">
      {{ problem }}
      <v-btn variant="text" size="small" :loading="loading" data-test="suggestion-retry" @click="loadNext">{{ $t('common.retry') }}</v-btn>
    </v-alert>
    <template v-if="(loaded && !loading) || items.length > 0">
      <SuggestionGrid v-if="shown.length > 0" :items="shown" @preview="emit('preview', $event)" />
      <p v-else-if="!problem" class="th-muted">{{ $t('downloads.suggestions.noneOfKind') }}</p>
      <v-btn v-if="hasMore && !problem" variant="tonal" size="small" class="mt-3" :loading="loading" data-test="suggestion-more" @click="loadNext">
        {{ $t('downloads.suggestions.showMore') }}
      </v-btn>
    </template>
  </section>
</template>

<style scoped>
.sugg {
  margin-bottom: 28px;
}
.sugg__heading {
  margin: 0 0 12px;
  font-size: 1.15rem;
  font-weight: 500;
}
/* About a row of posters, so the page does not jump as sections fill in. */
.sugg__wait {
  min-height: 14rem;
}
</style>
