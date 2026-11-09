<script setup lang="ts">
import { computed } from 'vue'
import { mdiHomeOutline } from '@mdi/js'
import MetadataNudge from '@/components/MetadataNudge.vue'
import SectionPage from '@/components/SectionPage.vue'
import PosterRail from '@/components/titles/PosterRail.vue'
import GenreRail from '@/components/titles/GenreRail.vue'
import { useGenres } from '@/composables/useGenres'
import { useTitles } from '@/composables/useTitles'
import { useContinueWatching } from '@/composables/useContinueWatching'
import CollectionRail from '@/components/collections/CollectionRail.vue'
import { useCollections } from '@/composables/useCollections'

/** Newest first, a short page each: Home is a shop window, the section pages are the full shelves. */
const RAIL = 24
const recent = useTitles({ kind: () => undefined, excludeKind: 'video', sort: 'added', limit: RAIL })
const movies = useTitles({ kind: () => 'movie', sort: 'added', limit: RAIL })
const series = useTitles({ kind: () => 'series', sort: 'added', limit: RAIL })

const { genres } = useGenres(() => undefined)

const resume = useContinueWatching()
const collections = useCollections()
const { captions: resumeCaptions } = resume
const resumeTitles = computed(() => resume.titles.value.filter((t) => t.kind !== 'video'))

const hasContent = computed(() => recent.total.value > 0)
const loading = computed(() => !recent.loaded.value && recent.error.value === null)
</script>

<template>
  <SectionPage section-key="home" :icon="mdiHomeOutline" title-key="nav.home" :has-content="hasContent" :loading="loading">
    <MetadataNudge />
    <PosterRail v-if="resumeTitles.length" :heading="$t('home.continue')" :titles="resumeTitles" :captions="resumeCaptions" continue-list data-test="continue-rail" />
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
    <CollectionRail v-if="collections.items.value.length > 0" :heading="$t('home.collections')" :collections="collections.items.value" :see-all="{ name: 'collections' }" />
    <GenreRail v-for="g in genres" :key="g" :genre="g" />
  </SectionPage>
</template>
