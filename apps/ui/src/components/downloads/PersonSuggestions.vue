<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GenreMode, MatchKind } from '@theama/contracts'
import { useMetadataStore } from '@/stores/metadata'
import { useConnectionStore } from '@/stores/connection'
import { useDownloadsViewStore } from '@/stores/downloadsView'
import { useSettingsStore } from '@/stores/settings'
import { matchesFindFilters } from '@/utils/downloadsFilters'
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
  years: number[]
  ratingRange: number[]
}>()
defineEmits<{ preview: [candidate: SuggestionItem]; back: [] }>()
const metadata = useMetadataStore()
const connection = useConnectionStore()
const view = useDownloadsViewStore()
const settings = useSettingsStore()
const key = computed(() => JSON.stringify([props.externalId, props.category, settings.settings.language]))
const state = computed(() => view.personResults[key.value] ?? { items: [], loaded: false, problem: null })
const items = computed(() => state.value.items)
const loading = ref(false)
const problem = computed(() => state.value.problem)
const retry = ref(0)
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const shown = computed(() => items.value.filter((item) =>
  matchesFindFilters(item, { kind: props.kind, years: props.years, genres: props.genres, genreMode: props.genreMode, ratingRange: props.ratingRange })
  && (!props.query.trim() || fold(`${item.title} ${item.originalTitle ?? ''}`).includes(fold(props.query.trim()))),
))

watch([() => props.externalId, () => props.category, () => connection.phase, retry, () => settings.settings.language], async ([id, category, phase, attempt], old, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  view.personResults[key.value] ??= { items: [], loaded: false, problem: null }
  const target = state.value
  loading.value = false
  if (phase !== 'connected') return
  const retryRequested = old.length > 0 && attempt !== old[3]
  if (target.loaded && !retryRequested) return
  target.problem = null
  loading.value = true
  const result = await metadata.personTitles(id, category, controller.signal)
  if (controller.signal.aborted) return
  loading.value = false
  target.loaded = true
  if (result.ok) target.items = result.items
  else target.problem = result.message
}, { immediate: true })
</script>

<template>
  <section class="mt-4" data-test="person-suggestions" :aria-label="$t(category === 'actor' ? 'detail.actorSuggestions' : 'detail.directorSuggestions', { name })">
    <v-btn variant="text" size="small" class="mb-2" data-test="person-back" @click="$emit('back')">{{ $t('downloads.find.allTitles') }}</v-btn>
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
