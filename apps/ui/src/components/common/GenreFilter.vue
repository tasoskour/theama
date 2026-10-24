<script setup lang="ts">
import type { GenreMode } from '@theama/contracts'

// Multi-select of genres with an Any/All switch ("comedy or crime" vs "comedy and crime").
// Shared by the library pages, global search and the downloads finder.
defineProps<{ items: string[] }>()
const model = defineModel<string[]>({ required: true })
const mode = defineModel<GenreMode>('mode', { default: 'any' })
</script>

<template>
  <div class="genre-filter">
    <!-- A placeholder (not a floating label) so chips never collide with the label at any text size. -->
    <v-select
      v-model="model"
      :items="items"
      :placeholder="$t('titles.genres')"
      :aria-label="$t('titles.genres')"
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
        <v-chip v-if="index < 2" size="small" label :text="model[index]" class="genre-filter__chip" />
        <span v-else-if="index === 2" class="th-muted text-caption ml-1 text-no-wrap">{{ $t('titles.genresMore', { n: model.length - 2 }) }}</span>
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
/* The select takes the room it can; the Any/All switch drops onto its own line only when the select
   would otherwise fall under ~12rem. */
.genre-filter__select {
  flex: 1 1 12rem;
  min-width: 0;
}
.genre-filter__chip {
  max-width: 8rem;
}
/* A quiet segmented control: a recessed track, and the chosen segment sits on it like a raised chip.
   Scoped here on purpose; the global .v-btn-toggle look is shared with other screens. */
.genre-filter__mode.v-btn-toggle {
  flex: 0 0 auto;
  box-sizing: border-box;
  height: var(--th-control-h) !important;
  padding: 3px !important;
  gap: 2px;
  border: var(--th-border) !important;
  border-radius: var(--th-radius) !important;
  background: rgb(var(--v-theme-surface-light));
}
.genre-filter__mode :deep(.v-btn) {
  height: 100% !important;
  min-height: 0 !important;
  min-width: 3.25rem;
  padding-block: 0 !important;
  padding-inline: 0.85rem;
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
}
</style>
