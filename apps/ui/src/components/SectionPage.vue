<script setup lang="ts">
import { ref } from 'vue'
import { mdiFolderMultipleOutline } from '@mdi/js'
import type { LibraryType } from '@theama/contracts'
import { useAddFolder } from '@/composables/useAddFolder'
import { useLibraryStore } from '@/stores/library'
import AddSourceDialog from './library/AddSourceDialog.vue'
import EmptyLibraryState from './EmptyLibraryState.vue'

const props = defineProps<{
  sectionKey: 'home' | 'movies' | 'series' | 'videos' | 'collections' | 'search'
  icon: string
  titleKey: string
}>()

const library = useLibraryStore()
const added = ref(false)

/** Adding a folder from the Movies page defaults to "Movies", and so on; elsewhere it is auto-detected. */
const SECTION_TYPE: Partial<Record<typeof props.sectionKey, LibraryType>> = { movies: 'movies', series: 'series', videos: 'videos' }
const flow = useAddFolder(() => SECTION_TYPE[props.sectionKey] ?? 'auto')
</script>

<template>
  <div class="th-page">
    <header class="mb-6">
      <p class="th-eyebrow mb-2">{{ $t('app.tagline') }}</p>
      <h1 class="th-display page-title">{{ $t(titleKey) }}</h1>
    </header>
    <slot name="toolbar" />

    <v-alert v-if="library.count > 0" type="info" variant="tonal" density="comfortable" class="notice" :icon="mdiFolderMultipleOutline">
      <div>{{ $t('library.sectionNotice', library.count) }}</div>
      <router-link to="/settings/library" class="notice__link">{{ $t('library.manage') }}</router-link>
    </v-alert>

    <EmptyLibraryState
      :icon="icon"
      :title-key="`empty.${sectionKey}.title`"
      :body-key="`empty.${sectionKey}.body`"
      @add-folder="flow.begin()"
    />

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
</style>
