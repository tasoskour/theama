<script setup lang="ts">
// Multi-select of genres ("any of these"). Shared by the library pages and global search.
defineProps<{ items: string[] }>()
const model = defineModel<string[]>({ required: true })
</script>

<template>
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
    class="genre-filter"
  >
    <template #selection="{ index }">
      <v-chip v-if="index < 2" size="small" label :text="model[index]" />
      <span v-else-if="index === 2" class="th-muted text-caption ml-1">{{ $t('titles.genresMore', { n: model.length - 2 }) }}</span>
    </template>
  </v-select>
</template>

<style scoped>
.genre-filter {
  min-width: 0;
}
</style>
