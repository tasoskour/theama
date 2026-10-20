<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiHomeOutline } from '@mdi/js'
import MetadataNudge from '@/components/MetadataNudge.vue'
import SectionPage from '@/components/SectionPage.vue'
import PosterRail from '@/components/titles/PosterRail.vue'
import { useTitles } from '@/composables/useTitles'
import { useContinueWatching } from '@/composables/useContinueWatching'
import { formatClock } from '@/utils/format'
import CollectionRail from '@/components/collections/CollectionRail.vue'
import { useCollections } from '@/composables/useCollections'

/** Newest first, a short page each: Home is a shop window, the section pages are the full shelves. */
const RAIL = 24
const i18n = useI18n()
const recent = useTitles({ kind: () => undefined, sort: 'added', limit: RAIL })
const movies = useTitles({ kind: () => 'movie', sort: 'added', limit: RAIL })
const series = useTitles({ kind: () => 'series', sort: 'added', limit: RAIL })
const videos = useTitles({ kind: () => 'video', sort: 'added', limit: RAIL })

const resume = useContinueWatching()
const collections = useCollections()
const resumeTitles = computed(() => resume.items.value.map((i) => i.summary))
const resumeCaption = (i: (typeof resume.items.value)[number]): string => {
  const time = formatClock(i.resumeSeconds)
  if (i.label) return i.resumeSeconds !== null ? i18n.t('play.resumeLabel', { label: i.label, time }) : `${i18n.t('play.upNext')} ${i.label}`
  return i.resumeSeconds !== null ? i18n.t('play.resumeFilm', { time }) : i18n.t('play.resume')
}
const resumeCaptions = computed(() => Object.fromEntries(resume.items.value.map((i) => [i.summary.key, resumeCaption(i)])))

const hasContent = computed(() => recent.total.value > 0)
const loading = computed(() => !recent.loaded.value && recent.error.value === null)
</script>

<template>
  <SectionPage section-key="home" :icon="mdiHomeOutline" title-key="nav.home" :has-content="hasContent" :loading="loading">
    <MetadataNudge />
    <PosterRail v-if="resumeTitles.length" :heading="$t('home.continue')" :titles="resumeTitles" :captions="resumeCaptions" data-test="continue-rail" />
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
    <PosterRail
      v-if="videos.total.value > 0"
      :heading="$t('nav.videos')"
      :titles="videos.items.value"
      :see-all="{ name: 'videos' }"
      :total="videos.total.value"
    />
  </SectionPage>
</template>
