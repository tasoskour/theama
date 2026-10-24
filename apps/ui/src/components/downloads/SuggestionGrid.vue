<script setup lang="ts">
import { ref } from 'vue'
import { mdiInformationOutline, mdiOpenInNew, mdiPlayCircleOutline, mdiStar } from '@mdi/js'
import type { MatchCandidate } from '@theama/contracts'
import PosterArt from '@/components/titles/PosterArt.vue'
import { useConnectionStore } from '@/stores/connection'

/** Search results are plain candidates; suggestions also carry a rating. */
type Item = MatchCandidate & { rating?: number | null }

defineProps<{
  items: Item[]
  /** The item (`kind:externalId`) whose trailer or IMDb link is being looked up. */
  busy?: string | null
}>()
defineEmits<{ pick: [candidate: Item]; trailer: [candidate: Item]; imdb: [candidate: Item] }>()

const connection = useConnectionStore()

const keyOf = (c: Item): string => `${c.kind}:${c.externalId}`
/** On touch screens there is no hover, so the info button opens the description. */
const shown = ref<string | null>(null)
const toggle = (c: Item): void => {
  shown.value = shown.value === keyOf(c) ? null : keyOf(c)
}
</script>

<template>
  <ul class="grid" role="list" data-test="suggestion-list">
    <li v-for="c in items" :key="`${c.provider}:${c.externalId}`" class="item" :class="{ 'item--info': shown === keyOf(c) }">
      <button type="button" class="card" :aria-label="c.year ? `${c.title} (${c.year})` : c.title" data-test="suggestion-item" @click="$emit('pick', c)">
        <PosterArt :seed="`${c.provider}:${c.externalId}`" :title="c.title" :year="c.year" :kind="c.kind" :image-url="connection.assetUrl(c.posterUrl)" />
        <span class="card__title">
          {{ c.title }}<span v-if="c.year" class="th-muted"> · {{ c.year }}</span>
          <span v-if="c.rating != null" class="card__rating" :title="$t('downloads.suggestions.rating', { value: c.rating.toFixed(1) })" data-test="suggestion-rating">
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path :d="mdiStar" fill="currentColor" /></svg>{{ c.rating.toFixed(1) }}
          </span>
        </span>
        <span class="card__kind th-muted">{{ $t(`downloads.suggestions.${c.kind}`) }}</span>
      </button>

      <!-- Over the poster: the description on hover or focus, and the links. Clicks on the text fall through to the card. -->
      <div class="over">
        <p v-if="c.overview" class="over__text" data-test="suggestion-description">{{ c.overview }}</p>
        <div class="over__actions">
          <v-btn
            v-if="c.overview"
            icon
            size="x-small"
            variant="flat"
            class="over__info"
            :aria-label="$t('downloads.suggestions.description')"
            :aria-pressed="shown === keyOf(c)"
            :title="$t('downloads.suggestions.description')"
            data-test="suggestion-info"
            @click.stop="toggle(c)"
          >
            <v-icon :icon="mdiInformationOutline" size="18" />
          </v-btn>
          <v-btn
            icon
            size="x-small"
            variant="flat"
            :loading="busy === keyOf(c)"
            :aria-label="`${$t('downloads.suggestions.trailer')}: ${c.title}`"
            :title="$t('downloads.suggestions.trailer')"
            data-test="suggestion-trailer"
            @click.stop="$emit('trailer', c)"
          >
            <v-icon :icon="mdiPlayCircleOutline" size="18" />
          </v-btn>
          <v-btn
            icon
            size="x-small"
            variant="flat"
            :loading="busy === keyOf(c)"
            :aria-label="`${$t('downloads.suggestions.imdb')}: ${c.title}`"
            :title="$t('downloads.suggestions.imdb')"
            data-test="suggestion-imdb"
            @click.stop="$emit('imdb', c)"
          >
            <v-icon :icon="mdiOpenInNew" size="18" />
          </v-btn>
        </div>
      </div>
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
.item {
  position: relative;
}
.card {
  display: grid;
  gap: 4px;
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
.item:hover :deep(.art),
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
.card__rating {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-inline-start: 6px;
  font-weight: 600;
  white-space: nowrap;
  color: rgb(var(--v-theme-primary));
}
.card__kind {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* The overlay covers the poster only (the card is poster, title, kind; the kind line is about 1.2rem tall). */
.over {
  position: absolute;
  inset: 0 0 auto 0;
  aspect-ratio: 2 / 3;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 8px;
  border-radius: var(--th-radius);
  background: linear-gradient(to top, rgba(0, 0, 0, 0.88), rgba(0, 0, 0, 0.55) 70%, rgba(0, 0, 0, 0.2));
  color: #f2ebdd;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--th-motion);
}
.item:hover .over,
.item:focus-within .over,
.item--info .over {
  opacity: 1;
}
.over__text {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 9;
  line-clamp: 9;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.over__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
}
.item:hover .over__actions .v-btn,
.item:focus-within .over__actions .v-btn,
.item--info .over__actions .v-btn {
  pointer-events: auto;
}
/* Without hover the description is hidden until the info button is pressed; the buttons stay reachable. */
@media (hover: none) {
  .over {
    opacity: 1;
    background: none;
  }
  .over__actions .v-btn {
    pointer-events: auto;
  }
  .over__text {
    display: none;
  }
  .item--info .over {
    background: linear-gradient(to top, rgba(0, 0, 0, 0.88), rgba(0, 0, 0, 0.55) 70%, rgba(0, 0, 0, 0.2));
  }
  .item--info .over__text {
    display: -webkit-box;
  }
}
</style>
