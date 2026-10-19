<script setup lang="ts">
import { mdiFolderMultipleOutline } from '@mdi/js'
import SectionPage from '@/components/SectionPage.vue'
</script>

<template>
  <SectionPage section-key="collections" :icon="mdiFolderMultipleOutline" title-key="nav.collections" />
</template>
