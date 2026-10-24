<script setup lang="ts">
import type { GenreMode } from '@theama/contracts'

// Multi-select of genres with an Any/All switch ("comedy or crime" vs "comedy and crime").
// Shared by the library pages and global search.
defineProps<{ items: string[] }>()
const model = defineModel<string[]>({ required: true })
const mode = defineModel<GenreMode>('mode', { default: 'any' })
</script>

<template>
  <div class="genre-filter">
    <v-select
      v-model="model"
      :items="items"
      :label="$t('titles.genres')"
      :no-data-text="$t('titles.noGenres')"
      multiple
      clearable
      chips
      closable-chips
      density="compact"
      variant="solo-filled"
      flat
      bg-color="surface-bright"
      hide-details
      class="genre-filter__select th-search-control"
    >
      <template #selection="{ index }">
        <v-chip v-if="index < 2" size="small" label :text="model[index]" />
        <span v-else-if="index === 2" class="th-muted text-caption ml-1">{{ $t('titles.genresMore', { n: model.length - 2 }) }}</span>
      </template>
    </v-select>
    <v-btn-toggle
      v-model="mode"
      mandatory
      density="compact"
      variant="text"
      :disabled="model.length < 2"
      :aria-label="$t('titles.genreMode')"
      class="genre-filter__mode"
    >
      <v-btn value="any" size="small" :title="$t('titles.genreAnyHint')">{{ $t('titles.genreAny') }}</v-btn>
      <v-btn value="all" size="small" :title="$t('titles.genreAllHint')">{{ $t('titles.genreAll') }}</v-btn>
    </v-btn-toggle>
  </div>
</template>

<style scoped>
.genre-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.genre-filter__select {
  flex: 1 1 10rem;
  min-width: 0;
}
/* A quiet segmented control: a recessed track, and the chosen segment sits on it like a raised chip.
   Scoped here on purpose; the global .v-btn-toggle look is shared with other screens. */
.genre-filter__mode.v-btn-toggle {
  flex: 0 0 auto;
  height: var(--th-control-h) !important;
  padding: 3px !important;
  gap: 2px;
  border: var(--th-border) !important;
  border-radius: var(--th-radius) !important;
  background: rgb(var(--v-theme-surface-light));
}
.genre-filter__mode :deep(.v-btn) {
  height: 100% !important;
  min-width: 52px;
  padding-inline: 14px;
  border-radius: calc(var(--th-radius) - 3px) !important;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
  letter-spacing: 0;
  transition:
    background-color var(--th-motion),
    color var(--th-motion);
}
.genre-filter__mode :deep(.v-btn__overlay) {
  display: none;
}
.genre-filter__mode :deep(.v-btn:hover) {
  color: rgb(var(--v-theme-on-surface));
}
.genre-filter__mode :deep(.v-btn--active) {
  background: rgb(var(--v-theme-surface-bright)) !important;
  color: rgb(var(--v-theme-primary)) !important;
  font-weight: 600;
  box-shadow: 0 0 0 1px rgba(var(--v-theme-hairline), 0.9);
}</style>
