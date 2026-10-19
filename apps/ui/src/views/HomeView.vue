<script setup lang="ts">
import { computed } from 'vue'
import { mdiHomeOutline } from '@mdi/js'
import MetadataNudge from '@/components/MetadataNudge.vue'
import SectionPage from '@/components/SectionPage.vue'
import PosterRail from '@/components/titles/PosterRail.vue'
import { useTitles } from '@/composables/useTitles'

/** Newest first, a short page each: Home is a shop window, the section pages are the full shelves. */
const RAIL = 24
const recent = useTitles({ kind: () => undefined, sort: 'added', limit: RAIL })
const movies = useTitles({ kind: () => 'movie', sort: 'added', limit: RAIL })
const series = useTitles({ kind: () => 'series', sort: 'added', limit: RAIL })
const videos = useTitles({ kind: () => 'video', sort: 'added', limit: RAIL })

const hasContent = computed(() => recent.total.value > 0)
</script>

<template>
  <SectionPage section-key="home" :icon="mdiHomeOutline" title-key="nav.home" :has-content="hasContent">
    <MetadataNudge />
    <PosterRail v-if="recent.items.value.length" :heading="$t('home.recent')" :titles="recent.items.value" />
    <PosterRail
      v-if="movies.total.value > 0"
      :heading="$t('nav.movies')"
      :titles="movies.items.value"
      :see-all="{ name: 'movies' }"
      :total="movies.total.value"
    />
    <PosterRail
      v-if="series.total.value > 0"
      :heading="$t('nav.series')"
      :titles="series.items.value"
      :see-all="{ name: 'series' }"
      :total="series.total.value"
    />
    <PosterRail
      v-if="videos.total.value > 0"
      :heading="$t('nav.videos')"
      :titles="videos.items.value"
      :see-all="{ name: 'videos' }"
      :total="videos.total.value"
    />
  </SectionPage>
</template>
