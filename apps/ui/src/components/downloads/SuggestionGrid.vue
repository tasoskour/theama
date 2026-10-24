<script setup lang="ts">
import { mdiHeart, mdiHeartOutline, mdiStar } from '@mdi/js'
import PosterArt from '@/components/titles/PosterArt.vue'
import { useConnectionStore } from '@/stores/connection'
import type { SuggestionItem } from './suggestion'
import { useFavoritesStore } from '@/stores/favorites'

defineProps<{ items: SuggestionItem[] }>()
defineEmits<{ preview: [candidate: SuggestionItem] }>()

const connection = useConnectionStore()
const favorites = useFavoritesStore()
</script>

<template>
  <ul class="grid" role="list" data-test="suggestion-list">
    <li v-for="c in items" :key="`${c.provider}:${c.kind}:${c.externalId}`" class="item">
      <button
        type="button"
        class="card"
        :title="$t('downloads.suggestions.preview', { title: c.year ? `${c.title} (${c.year})` : c.title })"
        aria-haspopup="dialog"
        data-test="suggestion-item"
        @click="$emit('preview', c)"
      >
        <span class="card__art">
          <PosterArt :seed="`${c.provider}:${c.externalId}`" :title="c.title" :year="c.year" :kind="c.kind" :image-url="connection.assetUrl(c.posterUrl)" />
          <span v-if="favorites.inLibrary(c)" class="card__added" data-test="suggestion-added">{{ $t('downloads.favorites.alreadyAdded') }}</span>
        </span>
        <span class="card__title">{{ c.title }}</span>
        <span class="card__meta th-muted">
          <span><span v-if="c.year">{{ c.year }} · </span>{{ $t(`downloads.suggestions.${c.kind}`) }}</span>
          <span v-if="c.rating != null" class="card__rating" :aria-label="$t('downloads.suggestions.rating', { value: c.rating.toFixed(1) })" data-test="suggestion-rating">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path :d="mdiStar" fill="currentColor" /></svg>{{ c.rating.toFixed(1) }}
          </span>
        </span>
        <span v-if="c.genres?.length" class="card__genres th-muted" data-test="suggestion-genres">{{ c.genres.join(' · ') }}</span>
      </button>
      <v-btn
        class="item__favorite"
        :icon="favorites.isFavorite(c) ? mdiHeart : mdiHeartOutline"
        :color="favorites.isFavorite(c) ? 'primary' : undefined"
        :aria-label="$t(favorites.isFavorite(c) ? 'downloads.favorites.remove' : 'downloads.favorites.add', { title: c.title })"
        :aria-pressed="favorites.isFavorite(c)"
        :loading="favorites.isPending(c)"
        :disabled="!favorites.loaded || favorites.isPending(c)"
        size="small"
        data-test="suggestion-favorite"
        @click="favorites.toggle(c)"
      />
    </li>
  </ul>
</template>

<style scoped>
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr));
  gap: 24px 16px;
}
.item {
  min-width: 0;
  position: relative;
}
.item__favorite {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 44px;
  min-height: 44px;
}
.card__added {
  position: absolute;
  bottom: 6px;
  left: 6px;
  right: 6px;
  width: fit-content;
  padding: 4px 8px;
  border-radius: var(--th-radius);
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.75rem;
  font-weight: 600;
}
.card {
  display: grid;
  align-content: start;
  gap: 8px;
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
.card__art {
  position: relative;
  display: block;
  border-radius: var(--th-radius);
}
.card__art::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid transparent;
  border-radius: inherit;
  pointer-events: none;
  transition: border-color var(--th-motion);
}
.card:hover .card__art::after,
.card:focus-visible .card__art::after {
  border-color: rgba(var(--v-theme-primary), 0.8);
}
.card:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 4px;
}
.card__title {
  min-height: 2.7em;
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 8px;
  font-size: 0.75rem;
  line-height: 1.4;
}
.card__rating {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-weight: 600;
  white-space: nowrap;
  color: rgb(var(--v-theme-primary));
}
.card__genres {
  font-size: 0.75rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
</style>
