<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiFolderPlusOutline } from '@mdi/js'
import type { LibraryType, TitleKind } from '@theama/contracts'
import { useAddFolder } from '@/composables/useAddFolder'
import { useSceneHint } from '@/composables/useSceneHint'
import { useTitles } from '@/composables/useTitles'
import { useLibraryStore } from '@/stores/library'
import { useScansStore } from '@/stores/scans'
import AddSourceDialog from './library/AddSourceDialog.vue'
import PosterGridSkeleton from './titles/PosterGridSkeleton.vue'
import TitleBrowser from './titles/TitleBrowser.vue'
import EmptyLibraryState from './EmptyLibraryState.vue'

type Section = 'home' | 'movies' | 'series' | 'videos' | 'collections' | 'search'
const props = defineProps<{
  sectionKey: Section
  icon: string
  titleKey: string
  /** Pages with their own content (Home's rails) say when they have some; the empty state shows otherwise. */
  hasContent?: boolean
  /** Content pages say when their first data is still loading; browsing pages work it out themselves. */
  loading?: boolean
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
const shelves = kind === 'movie' || kind === 'series'
const list = useTitles({ kind: () => kind, sort: shelves ? 'added' : 'title', remember: true })
const { total, q, genres, hideUnavailable, loaded, error } = list
// The 3D backdrop (immersive mode) can follow the kind of title listed and the genres picked in the filter.
useSceneHint(() => (kind ? { kind, genres: genres.value, genreOrder: 'listed' } : {}))

/** Until the first answer is in, show a placeholder rather than a (wrong) empty state. */
const pending = computed(() => props.loading ?? (kind !== null && !loaded.value && error.value === null))
const showList = computed(() => kind !== null && (total.value > 0 || q.value.trim() !== '' || genres.value.length > 0 || hideUnavailable.value))
const showContent = computed(() => kind === null && props.hasContent === true)
const nothingOfKind = computed(() => kind !== null && loaded.value && !showList.value && library.count > 0 && !scans.scanning)
const canAddMediaFolder = computed(() => ['home', 'movies', 'series', 'videos'].includes(props.sectionKey))
// Once onboarding is over, keep folder management within reach instead of
// hiding its only entry point with the empty state.
const showHeaderAdd = computed(() => canAddMediaFolder.value && library.count > 0)
</script>

<template>
  <div class="th-page th-page--wide">
    <header class="page-header th-page-header">
      <div>
        <p class="th-eyebrow mb-2">{{ $t('app.tagline') }}</p>
        <h1 class="th-display th-page-title">{{ $t(titleKey) }}</h1>
      </div>
      <v-btn
        v-if="showHeaderAdd"
        color="primary"
        variant="tonal"
        :prepend-icon="mdiFolderPlusOutline"
        @click="flow.begin()"
      >
        {{ $t('library.add') }}
      </v-btn>
    </header>
    <slot name="toolbar" />

    <v-alert v-if="scans.scanning && (showList || showContent)" type="info" variant="tonal" density="compact" class="mb-4" role="status">
      {{ $t('scan.headline') }}
    </v-alert>

    <!-- One swap, once: skeleton -> content. The empty state never shows while the first page is still on its way. -->
    <transition name="th-fade" mode="out-in">
      <PosterGridSkeleton v-if="pending" key="pending" />
      <TitleBrowser v-else-if="showList" key="list" :list="list" :label="$t(titleKey)" :kind="kind ?? undefined" :shelves="shelves" />
      <div v-else-if="showContent" key="content"><slot /></div>

      <div v-else key="empty">
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
      </div>
    </transition>

    <AddSourceDialog :flow="flow" @added="added = true" />
    <v-snackbar v-model="added" :timeout="3000" color="surface-bright">{{ $t('library.added') }}</v-snackbar>
  </div>
</template>

<style scoped>
.page-header {
  gap: 24px;
}
.notice {
  max-width: min(40rem, 100%);
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
  padding: clamp(2rem, 8vh, 4.5rem) 1rem;
  text-align: center;
}
.scanning__bar {
  width: min(20rem, 100%);
}
.scanning__title {
  font-size: 1.5rem;
  margin: 12px 0 0;
}
@media (max-width: 600px) {
  .page-header {
    align-items: flex-start;
  }
}
</style>
