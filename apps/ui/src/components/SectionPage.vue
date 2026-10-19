<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LibraryType, TitleKind } from '@theama/contracts'
import { useAddFolder } from '@/composables/useAddFolder'
import { useTitles } from '@/composables/useTitles'
import { useLibraryStore } from '@/stores/library'
import { useScansStore } from '@/stores/scans'
import AddSourceDialog from './library/AddSourceDialog.vue'
import TitleBrowser from './titles/TitleBrowser.vue'
import EmptyLibraryState from './EmptyLibraryState.vue'

type Section = 'home' | 'movies' | 'series' | 'videos' | 'collections' | 'search'
const props = defineProps<{
  sectionKey: Section
  icon: string
  titleKey: string
  /** Pages with their own content (Home's rails) say when they have some; the empty state shows otherwise. */
  hasContent?: boolean
}>()

const library = useLibraryStore()
const scans = useScansStore()
const added = ref(false)

/** Adding a folder from the Movies page defaults to "Movies", and so on; elsewhere it is auto-detected. */
const SECTION_TYPE: Partial<Record<Section, LibraryType>> = { movies: 'movies', series: 'series', videos: 'videos' }
const flow = useAddFolder(() => SECTION_TYPE[props.sectionKey] ?? 'auto')

/** Pages that browse titles, and which kind of title each one shows. */
const SECTION_KIND: Partial<Record<Section, TitleKind>> = { movies: 'movie', series: 'series', videos: 'video' }
const kind = SECTION_KIND[props.sectionKey] ?? null
const list = useTitles({ kind: () => kind, remember: true })
const { total, q, hideUnavailable, loaded } = list

const showList = computed(() => kind !== null && (total.value > 0 || q.value.trim() !== '' || hideUnavailable.value))
const showContent = computed(() => kind === null && props.hasContent === true)
const nothingOfKind = computed(() => kind !== null && loaded.value && !showList.value && library.count > 0 && !scans.scanning)
</script>

<template>
  <div class="th-page">
    <header class="mb-6">
      <p class="th-eyebrow mb-2">{{ $t('app.tagline') }}</p>
      <h1 class="th-display page-title">{{ $t(titleKey) }}</h1>
    </header>
    <slot name="toolbar" />

    <v-alert v-if="scans.scanning && (showList || showContent)" type="info" variant="tonal" density="compact" class="mb-4" role="status">
      {{ $t('scan.headline') }}
    </v-alert>

    <TitleBrowser v-if="showList" :list="list" :label="$t(titleKey)" />
    <slot v-else-if="showContent" />

    <template v-else>
      <section v-if="scans.scanning" class="scanning" role="status">
        <v-progress-linear indeterminate color="primary" rounded class="scanning__bar" />
        <h2 class="th-display scanning__title">{{ $t('scan.headline') }}</h2>
        <p class="th-muted">{{ $t('scan.headlineHint') }}</p>
      </section>
      <template v-else>
        <v-alert v-if="nothingOfKind" type="info" variant="tonal" density="comfortable" class="notice">
          <div>{{ $t('scan.nothingOfKind') }}</div>
          <router-link to="/settings/library" class="notice__link">{{ $t('library.manage') }}</router-link>
        </v-alert>
        <EmptyLibraryState
          :icon="icon"
          :title-key="`empty.${sectionKey}.title`"
          :body-key="`empty.${sectionKey}.body`"
          @add-folder="flow.begin()"
        />
      </template>
    </template>

    <AddSourceDialog :flow="flow" @added="added = true" />
    <v-snackbar v-model="added" :timeout="3000" color="surface-bright">{{ $t('library.added') }}</v-snackbar>
  </div>
</template>

<style scoped>
.page-title {
  font-size: clamp(2rem, 4vw, 3rem);
  margin: 0;
}
.notice {
  max-width: 640px;
  margin: 0 auto;
}
.notice__link {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.scanning {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 72px 16px;
  text-align: center;
}
.scanning__bar {
  width: min(320px, 100%);
}
.scanning__title {
  font-size: 1.5rem;
  margin: 12px 0 0;
}
</style>
