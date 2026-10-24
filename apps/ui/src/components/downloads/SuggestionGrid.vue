<script setup lang="ts">
import type { MatchCandidate } from '@theama/contracts'
import PosterArt from '@/components/titles/PosterArt.vue'
import { useConnectionStore } from '@/stores/connection'

defineProps<{ items: MatchCandidate[] }>()
defineEmits<{ pick: [candidate: MatchCandidate] }>()

const connection = useConnectionStore()
</script>

<template>
  <ul class="grid" role="list" data-test="suggestion-list">
    <li v-for="c in items" :key="`${c.provider}:${c.externalId}`">
      <button type="button" class="card" :aria-label="c.year ? `${c.title} (${c.year})` : c.title" data-test="suggestion-item" @click="$emit('pick', c)">
        <PosterArt :seed="`${c.provider}:${c.externalId}`" :title="c.title" :year="c.year" :kind="c.kind" :image-url="connection.assetUrl(c.posterUrl)" />
        <span class="card__title">{{ c.title }}<span v-if="c.year" class="th-muted"> · {{ c.year }}</span></span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 16px 14px;
}
.card {
  display: grid;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: var(--th-radius);
}
.card:hover :deep(.art),
.card:focus-visible :deep(.art) {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.8);
}
.card:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 3px;
}
.card__title {
  font-size: 0.82rem;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
</style>
