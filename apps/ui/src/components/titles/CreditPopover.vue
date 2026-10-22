<script setup lang="ts">
import type { TitleCredit } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'
import PosterArt from './PosterArt.vue'

defineProps<{ credit: TitleCredit }>()
const connection = useConnectionStore()
</script>

<template>
  <v-menu open-on-hover open-on-focus open-on-click :open-delay="120" :close-delay="180" location="top start" max-width="360">
    <template #activator="{ props: menuProps }">
      <button v-bind="menuProps" type="button" class="credit" :data-test="`credit-${credit.category}`">
        <span class="credit__name">{{ credit.name }}</span>
        <span v-if="credit.character" class="th-muted credit__role">{{ credit.character }}</span>
      </button>
    </template>

    <v-card class="credit-popover" role="region" :aria-label="$t('detail.otherWith', { name: credit.name })">
      <v-card-title class="credit-popover__name">{{ credit.name }}</v-card-title>
      <v-card-subtitle>{{ $t(credit.category === 'director' ? 'detail.director' : 'detail.actor') }}</v-card-subtitle>
      <v-divider class="mt-3" />
      <p v-if="credit.relatedTitles.length === 0" class="th-muted credit-popover__empty">{{ $t('detail.noOtherTitles') }}</p>
      <v-list v-else density="compact" class="credit-popover__list" :aria-label="$t('detail.otherAvailableTitles')">
        <v-list-item
          v-for="title in credit.relatedTitles"
          :key="title.key"
          :to="{ name: 'title', query: { key: title.key } }"
          :title="title.title"
          :subtitle="title.year ? String(title.year) : $t(`detail.kind.${title.kind}`)"
          class="credit-popover__title"
          data-test="credit-related-title"
        >
          <template #prepend>
            <div class="credit-popover__poster">
              <PosterArt :seed="title.key" :title="title.title" :year="title.year" :kind="title.kind" :image-url="connection.assetUrl(title.posterUrl)" />
            </div>
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </v-menu>
</template>

<style scoped>
.credit {
  appearance: none;
  display: grid;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--th-motion), border-color var(--th-motion);
}
.credit:hover,
.credit:focus-visible,
.credit[aria-expanded='true'] {
  background: rgba(var(--v-theme-primary), 0.09);
  border-color: rgba(var(--v-theme-primary), 0.28);
  outline: none;
}
.credit__name {
  font-weight: 650;
}
.credit__role {
  font-size: 0.85rem;
}
.credit-popover {
  width: min(360px, calc(100vw - 24px));
  overflow: hidden;
}
.credit-popover__name {
  padding-bottom: 2px;
  font-weight: 700;
}
.credit-popover__empty {
  margin: 0;
  padding: 18px 16px;
  line-height: 1.45;
}
.credit-popover__list {
  max-height: 330px;
  overflow-y: auto;
}
.credit-popover__title {
  min-height: 76px;
}
.credit-popover__poster {
  width: 38px;
  margin-right: 12px;
  border-radius: 5px;
  overflow: hidden;
}
</style>
