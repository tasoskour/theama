<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GenreMode, MatchKind, Suggestion } from '@theama/contracts'
import { useMetadataStore } from '@/stores/metadata'
import { useConnectionStore } from '@/stores/connection'
import SuggestionGrid from './SuggestionGrid.vue'
import type { SuggestionItem } from './suggestion'

const props = defineProps<{
  externalId: string
  category: 'actor' | 'director'
  name: string
  kind: MatchKind | 'all'
  genres: string[]
  genreMode: GenreMode
  query: string
  year: number | null
}>()
defineEmits<{ preview: [candidate: SuggestionItem] }>()
const metadata = useMetadataStore()
const connection = useConnectionStore()
const items = ref<Suggestion[]>([])
const loading = ref(false)
const problem = ref<string | null>(null)
const retry = ref(0)
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const shown = computed(() => items.value.filter((item) =>
  (props.kind === 'all' || item.kind === props.kind)
  && (props.kind !== 'movie' || props.year === null || item.year === props.year)
  && (!props.query.trim() || fold(`${item.title} ${item.originalTitle ?? ''}`).includes(fold(props.query.trim())))
  && (props.genres.length === 0 || (props.genreMode === 'all'
    ? props.genres.every((genre) => item.genres?.includes(genre))
    : props.genres.some((genre) => item.genres?.includes(genre)))),
))

watch([() => props.externalId, () => props.category, () => connection.phase, retry], async ([id, category, phase], _old, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  items.value = []
  problem.value = null
  loading.value = true
  if (phase !== 'connected') return
  const result = await metadata.personTitles(id, category, controller.signal)
  if (controller.signal.aborted) return
  loading.value = false
  if (result.ok) items.value = result.items
  else problem.value = result.message
}, { immediate: true })
</script>

<template>
  <section class="mt-4" data-test="person-suggestions" :aria-label="$t(category === 'actor' ? 'detail.actorSuggestions' : 'detail.directorSuggestions', { name })">
    <h2 class="th-display mb-3">{{ $t(category === 'actor' ? 'detail.actorSuggestions' : 'detail.directorSuggestions', { name }) }}</h2>
    <v-progress-linear v-if="loading" indeterminate :aria-label="$t('detail.loadingPersonTitles')" />
    <v-alert v-else-if="problem" type="warning" variant="tonal" data-test="person-suggestions-error">
      {{ problem }}
      <v-btn variant="text" size="small" data-test="person-suggestions-retry" @click="retry++">{{ $t('common.retry') }}</v-btn>
    </v-alert>
    <SuggestionGrid v-else-if="shown.length" :items="shown" @preview="$emit('preview', $event)" />
    <p v-else class="th-muted" data-test="person-suggestions-empty">{{ $t(items.length ? 'downloads.find.noMatches' : 'detail.noPersonTitles') }}</p>
  </section>
</template>
