<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { MatchCandidate, Suggestion, SuggestionSection } from '@theama/contracts'
import { useMetadataStore } from '@/stores/metadata'
import SuggestionGrid from './SuggestionGrid.vue'

const props = defineProps<{ heading: string; section: SuggestionSection; year?: number; busy?: string | null }>()
const emit = defineEmits<{ pick: [candidate: MatchCandidate]; trailer: [candidate: MatchCandidate]; imdb: [candidate: MatchCandidate]; problem: [message: string] }>()

const metadata = useMetadataStore()

const items = ref<Suggestion[]>([])
const page = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loaded = ref(false)

/** One page at a time; a second click while a page is on its way does nothing. */
async function loadNext(): Promise<void> {
  if (loading.value) return
  loading.value = true
  const res = await metadata.suggestions(props.section, props.year, page.value + 1)
  loading.value = false
  loaded.value = true
  if (!res.ok) {
    emit('problem', res.message)
    return
  }
  page.value += 1
  const known = new Set(items.value.map((c) => c.externalId + c.kind))
  items.value = [...items.value, ...res.items.filter((c) => !known.has(c.externalId + c.kind))]
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
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section v-if="!loaded || items.length > 0" ref="root" class="sugg" :aria-label="heading" data-test="suggestion-section">
    <h2 class="sugg__heading th-display">{{ heading }}</h2>
    <v-progress-linear v-if="loading && items.length === 0" indeterminate height="2" :aria-label="heading" />
    <div v-else-if="!loaded" class="sugg__wait" aria-hidden="true" />
    <template v-if="items.length > 0">
      <SuggestionGrid :items="items" :busy="busy ?? null" @pick="emit('pick', $event)" @trailer="emit('trailer', $event)" @imdb="emit('imdb', $event)" />
      <v-btn v-if="hasMore" variant="tonal" size="small" class="mt-3" :loading="loading" data-test="suggestion-more" @click="loadNext">
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
  min-height: 220px;
}
</style>
