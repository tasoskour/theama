<script setup lang="ts">
import { mdiHomeOutline } from '@mdi/js'
import SectionPage from '@/components/SectionPage.vue'
</script>

<template>
  <SectionPage section-key="home" :icon="mdiHomeOutline" title-key="nav.home" />
</template>
