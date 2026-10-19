<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CollectionSummary } from '@theama/contracts'
import PosterArt from '@/components/titles/PosterArt.vue'
import { useConnectionStore } from '@/stores/connection'

const props = defineProps<{ collection: CollectionSummary }>()
const { t } = useI18n()
const connection = useConnectionStore()

/** The set's own poster, else the poster of its first local title, else the generated one. */
const image = computed(() => connection.assetUrl(props.collection.posterUrl ?? props.collection.previewPosters[0] ?? null))
const detail = computed(() =>
  props.collection.kind === 'official'
    ? t('collections.inLibrary', { local: props.collection.localCount, total: props.collection.memberCount })
    : t('collections.titles', props.collection.memberCount),
)
const label = computed(() => `${props.collection.name}, ${detail.value}`)
</script>

<template>
  <router-link class="card" :to="{ name: 'collection', query: { id: collection.id } }" :aria-label="label" :data-collection-id="collection.id">
    <div class="card__art">
      <PosterArt :seed="`collection:${collection.id}`" :title="collection.name" kind="movie" :image-url="image" />
      <span v-if="collection.kind === 'user'" class="card__badge">{{ $t('collections.mine') }}</span>
    </div>
    <div class="card__meta" aria-hidden="true">
      <div class="card__title">{{ collection.name }}</div>
      <div class="card__detail th-muted">{{ detail }}</div>
    </div>
  </router-link>
</template>

<style scoped>
.card {
  display: block;
  color: inherit;
  text-decoration: none;
  border-radius: calc(var(--th-radius) + 2px);
  outline-offset: 4px;
}
.card__art {
  position: relative;
  transition:
    transform var(--th-motion),
    box-shadow var(--th-motion);
}
.card:hover .card__art,
.card:focus-visible .card__art {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
}
.card__badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  font-size: 0.7rem;
  border-radius: 999px;
  background: rgba(15, 14, 12, 0.82);
  color: #efe8da;
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.card__meta {
  padding: 10px 2px 0;
}
.card__title {
  font-weight: 600;
  font-size: 0.92rem;
  line-height: 1.25;
}
.card__detail {
  font-size: 0.8rem;
  margin-top: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .card:hover .card__art,
  .card:focus-visible .card__art {
    transform: none;
  }
}
</style>
