<script setup lang="ts">
import { mdiMovieOpenOutline } from '@mdi/js'
import SectionPage from '@/components/SectionPage.vue'
</script>

<template>
  <SectionPage section-key="movies" :icon="mdiMovieOpenOutline" title-key="nav.movies" />
</template>
