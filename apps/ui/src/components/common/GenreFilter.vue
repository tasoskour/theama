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
      class="genre-filter__select"
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
      color="primary"
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
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.genre-filter__select {
  flex: 1 1 auto;
  min-width: 0;
}
.genre-filter__mode {
  flex: 0 0 auto;
}
</style>
