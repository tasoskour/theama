<script setup lang="ts">
import type { TitleKind, TitleSummary } from '@theama/contracts'
import { useContinueWatching } from '@/composables/useContinueWatching'
import GenreRail from './GenreRail.vue'
import PosterRail from './PosterRail.vue'

const props = defineProps<{ kind: TitleKind; genres: string[]; recent: TitleSummary[]; total: number }>()
defineEmits<{ browse: [genre?: string] }>()
const { titles: resumeTitles, captions: resumeCaptions } = useContinueWatching(20, () => props.kind)
</script>

<template>
  <div data-test="title-shelves">
    <PosterRail
      v-if="resumeTitles.length"
      :heading="$t('home.continue')"
      :titles="resumeTitles"
      :captions="resumeCaptions"
      continue-list
      data-test="continue-rail"
    />
    <PosterRail
      v-if="recent.length"
      :heading="$t('home.recent')"
      :titles="recent.slice(0, 24)"
      :total="total"
      browse-all
      @see-all="$emit('browse')"
    />
    <GenreRail
      v-for="genre in genres"
      :key="genre"
      :genre="genre"
      :kind="kind"
      browse-all
      @see-all="$emit('browse', genre)"
    />
  </div>
</template>
