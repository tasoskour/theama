<script setup lang="ts">
import { mdiTelevisionClassic } from '@mdi/js'
import SectionPage from '@/components/SectionPage.vue'
</script>

<template>
  <SectionPage section-key="series" :icon="mdiTelevisionClassic" title-key="nav.series" />
</template>
