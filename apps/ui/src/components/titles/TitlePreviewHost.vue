<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MatchCandidate } from '@theama/contracts'
import SuggestionDetailsDialog from '@/components/downloads/SuggestionDetailsDialog.vue'
import type { SuggestionItem } from '@/components/downloads/suggestion'
import { imdbLinkFor, openExternal, trailerInApp } from '@/composables/useExternalLinks'
import { useMetadataStore } from '@/stores/metadata'
import TrailerDialog from './TrailerDialog.vue'

const props = withDefaults(defineProps<{ canFindReleases?: boolean; missing?: boolean; focusFallback?: string }>(), {
  canFindReleases: true,
  missing: false,
  focusFallback: '',
})
const emit = defineEmits<{ pick: [candidate: SuggestionItem] }>()
const { t } = useI18n()
const metadata = useMetadataStore()
const candidate = ref<SuggestionItem | null>(null)
const open = ref(false)
const busy = ref<'trailer' | 'imdb' | null>(null)
const problem = ref<string | null>(null)
const trailer = ref<{ key: string; title: string } | null>(null)
const trailerOpen = ref(false)
let generation = 0
let activator: HTMLElement | null = null
let trailerActivator: HTMLElement | null = null

function invalidate(): void {
  generation += 1
  busy.value = null
  problem.value = null
}
watch(open, invalidate, { flush: 'sync' })
onBeforeUnmount(invalidate)

function show(item: SuggestionItem, focusTarget?: HTMLElement | null): void {
  activator = focusTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  candidate.value = item
  open.value = true
}

function close(): void {
  open.value = false
  trailerOpen.value = false
}

function restoreFocus(): void {
  if (open.value) return
  const target = activator?.isConnected ? activator : props.focusFallback ? document.querySelector<HTMLElement>(props.focusFallback) : null
  target?.focus({ preventScroll: true })
}

watch(trailerOpen, async (shown) => {
  if (!shown && open.value) {
    await nextTick()
    trailerActivator?.focus({ preventScroll: true })
  }
})

// Card data opens the preview. The cached details endpoint is called only when a link is selected.
async function withDetails(item: MatchCandidate, action: 'trailer' | 'imdb', use: (details: { imdbId: string | null; trailer: { key: string } | null }) => void | Promise<void>): Promise<void> {
  if (busy.value || !open.value) return
  const mine = generation
  busy.value = action
  problem.value = null
  try {
    const result = await metadata.suggestionDetails(item.kind, item.externalId)
    if (mine !== generation) return
    if (!result.ok) throw new Error(t('downloads.suggestions.details', { message: result.message }))
    await use(result)
  } catch (error) {
    if (mine === generation) problem.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (mine === generation) busy.value = null
  }
}

function showTrailer(item: MatchCandidate): Promise<void> {
  trailerActivator = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return withDetails(item, 'trailer', (details) => {
    if (!details.trailer) throw new Error(t('downloads.suggestions.noTrailer'))
    if (trailerInApp) {
      trailer.value = { key: details.trailer.key, title: item.title }
      trailerOpen.value = true
    } else return openExternal({ service: 'youtube', id: details.trailer.key })
  })
}

function showImdb(item: MatchCandidate): Promise<void> {
  return withDetails(item, 'imdb', (details) => {
    const link = imdbLinkFor(details.imdbId)
    if (!link) throw new Error(t('downloads.suggestions.noImdb'))
    return openExternal(link)
  })
}

async function showTmdb(item: MatchCandidate): Promise<void> {
  problem.value = null
  try {
    await openExternal({ service: 'tmdb', kind: item.kind, id: item.externalId })
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error)
  }
}

function pick(item: SuggestionItem): void {
  close()
  emit('pick', item)
}

defineExpose({ show, close })
</script>

<template>
  <SuggestionDetailsDialog
    v-if="candidate"
    v-model="open"
    :candidate="candidate"
    :busy="busy"
    :problem="problem"
    :can-find-releases="canFindReleases"
    :missing="missing"
    @pick="pick"
    @trailer="showTrailer"
    @imdb="showImdb"
    @tmdb="showTmdb"
    @closed="restoreFocus"
  />
  <TrailerDialog v-if="trailerInApp && trailer" v-model="trailerOpen" :video-id="trailer.key" :title="trailer.title" @youtube="openExternal({ service: 'youtube', id: trailer.key })" />
</template>
