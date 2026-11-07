<script setup lang="ts">
import { useId } from 'vue'
import { mdiClose, mdiHeart, mdiHeartOutline, mdiMagnify, mdiOpenInNew, mdiPlayCircleOutline, mdiStar } from '@mdi/js'
import imdbLogo from '@/assets/brand/imdb.png'
import PosterArt from '@/components/titles/PosterArt.vue'
import { useConnectionStore } from '@/stores/connection'
import type { SuggestionItem } from './suggestion'
import { useFavoritesStore } from '@/stores/favorites'

defineProps<{
  candidate: SuggestionItem
  busy: 'trailer' | 'imdb' | null
  problem: string | null
  canFindReleases?: boolean
  missing?: boolean
}>()
const open = defineModel<boolean>({ required: true })
defineEmits<{ pick: [candidate: SuggestionItem]; trailer: [candidate: SuggestionItem]; imdb: [candidate: SuggestionItem]; tmdb: [candidate: SuggestionItem]; closed: [] }>()

const connection = useConnectionStore()
const headingId = useId()
const favorites = useFavoritesStore()
</script>

<template>
  <v-dialog v-model="open" max-width="48rem" :aria-labelledby="headingId" class="suggestion-dialog" @after-leave="$emit('closed')">
    <v-card class="details" data-test="suggestion-dialog">
      <header class="details__header">
        <span class="th-eyebrow">{{ $t('downloads.suggestions.description') }}</span>
        <v-btn :icon="mdiClose" variant="text" :aria-label="$t('common.close')" data-test="suggestion-close" @click="open = false" />
      </header>

      <div class="details__body" tabindex="0" :aria-labelledby="headingId" role="region" data-test="suggestion-body">
        <div class="details__poster">
          <PosterArt :seed="`${candidate.provider}:${candidate.externalId}`" :title="candidate.title" :year="candidate.year" :kind="candidate.kind" :image-url="connection.assetUrl(candidate.posterUrl)" />
        </div>
        <div class="details__content">
          <h2 :id="headingId" class="details__title th-display">{{ candidate.title }}</h2>
          <div class="details__meta th-muted">
            <v-chip v-if="favorites.inLibrary(candidate)" size="small" data-test="suggestion-detail-added">{{ $t('downloads.favorites.alreadyAdded') }}</v-chip>
            <v-chip v-else-if="missing" size="small" color="warning" variant="tonal">{{ $t('collections.notInLibrary') }}</v-chip>
            <span>{{ $t(`downloads.suggestions.${candidate.kind}`) }}</span>
            <span v-if="candidate.year">{{ candidate.year }}</span>
            <span v-if="candidate.rating != null" class="details__rating" :aria-label="$t('downloads.suggestions.rating', { value: candidate.rating.toFixed(1) })" data-test="suggestion-detail-rating">
              <svg viewBox="0 0 24 24" class="th-icon" aria-hidden="true"><path :d="mdiStar" fill="currentColor" /></svg>TMDB {{ candidate.rating.toFixed(1) }}<span class="th-muted">/ 10</span>
            </span>
          </div>
          <p class="details__description" :class="{ 'th-muted': !candidate.overview?.trim() }" data-test="suggestion-description">{{ candidate.overview?.trim() || $t('downloads.suggestions.noDescription') }}</p>
        </div>
      </div>

      <footer class="details__footer">
        <v-alert v-if="problem" type="warning" variant="tonal" density="compact" class="details__problem" data-test="suggestion-link-error">{{ problem }}</v-alert>
        <div class="details__actions">
          <v-btn
            variant="tonal"
            :prepend-icon="favorites.isFavorite(candidate) ? mdiHeart : mdiHeartOutline"
            :aria-label="`${$t(favorites.isFavorite(candidate) ? 'downloads.favorites.saved' : 'downloads.favorites.save')}: ${candidate.title}`"
            :aria-pressed="favorites.isFavorite(candidate)"
            :loading="favorites.isPending(candidate)"
            :disabled="!favorites.loaded || favorites.isPending(candidate)"
            data-test="suggestion-detail-favorite"
            @click="favorites.toggle(candidate)"
          >{{ $t(favorites.isFavorite(candidate) ? 'downloads.favorites.saved' : 'downloads.favorites.save') }}</v-btn>
          <v-btn v-if="canFindReleases !== false" color="primary" :prepend-icon="mdiMagnify" data-test="suggestion-releases" @click="$emit('pick', candidate)">{{ $t('downloads.suggestions.findReleases') }}</v-btn>
          <v-btn variant="outlined" :append-icon="mdiOpenInNew" data-test="suggestion-tmdb" @click="$emit('tmdb', candidate)">{{ $t('metadata.tmdb') }}</v-btn>
          <v-btn variant="outlined" :prepend-icon="mdiPlayCircleOutline" :loading="busy === 'trailer'" :disabled="busy !== null" data-test="suggestion-trailer" @click="$emit('trailer', candidate)">{{ $t('downloads.suggestions.trailer') }}</v-btn>
          <v-btn variant="text" class="th-imdb-btn" :aria-label="$t('downloads.suggestions.imdb')" :title="$t('downloads.suggestions.imdb')" :loading="busy === 'imdb'" :disabled="busy !== null" data-test="suggestion-imdb" @click="$emit('imdb', candidate)">
            <img :src="imdbLogo" alt="" class="th-imdb-btn__logo" />
          </v-btn>
        </div>
      </footer>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.details {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 3rem);
  overflow: hidden;
  border-radius: var(--th-radius-lg);
}
.details__header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 12px 0 24px;
}
.details__body {
  display: grid;
  grid-template-columns: minmax(6rem, 10rem) minmax(0, 1fr);
  align-items: start;
  gap: 24px;
  padding: 16px 24px 24px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.details__body:focus-visible {
  outline-offset: -4px;
}
.details__content {
  min-width: 0;
}
.details__title {
  margin: 0;
  font-size: clamp(1.5rem, calc(3vw * var(--th-text-scale)), 2rem);
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.details__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-top: 12px;
  font-size: 0.85rem;
}
.details__rating {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.details__description {
  margin: 20px 0 0;
  font-size: 1rem;
  line-height: 1.65;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.details__footer {
  flex: none;
  padding: 20px 24px 24px;
  border-top: var(--th-border);
  background: rgb(var(--v-theme-surface));
}
.details__problem {
  margin-bottom: 16px;
}
.details__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.details__actions .v-btn {
  min-height: 2.75rem;
  height: auto;
  max-width: 100%;
  padding-block: 0.6em;
}
.details__actions :deep(.v-btn__content) {
  white-space: normal;
}
@media (max-width: 639px) {
  .details__body {
    grid-template-columns: minmax(5rem, 30%) minmax(0, 1fr);
    gap: 16px;
    padding-inline: 16px;
  }
  .details__actions .v-btn {
    flex: 1 1 100%;
  }
}
</style>
