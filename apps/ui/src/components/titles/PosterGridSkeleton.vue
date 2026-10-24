<script setup lang="ts">
withDefaults(defineProps<{ count?: number }>(), { count: 18 })
</script>

<template>
  <!-- Holds the grid's place while the first page loads, so the page does not flash an empty state. -->
  <div class="grid" role="status" :aria-label="$t('common.loading')">
    <div v-for="n in count" :key="n" class="cell">
      <div class="poster" />
      <div class="line" />
      <div class="line line--short" />
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--th-poster-min), 1fr));
  gap: var(--th-poster-gap);
  padding: 8px 4px 24px;
  overflow: hidden;
  /* One row's worth of height is enough; the rest is clipped so a big window never shows a wall of blocks. */
  max-height: 80vh;
}
.cell {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.poster,
.line {
  border-radius: var(--th-radius);
  background: rgb(var(--v-theme-surface-light));
  opacity: 0.55;
}
.poster {
  aspect-ratio: 2 / 3;
}
.line {
  height: 0.7em;
  width: 80%;
}
.line--short {
  width: 45%;
}
</style>
