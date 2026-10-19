<script setup lang="ts">
defineProps<{ sectionKey: 'metadata' | 'playback' | 'files' }>()
</script>

<template>
  <section>
    <h2 class="th-display section-title">{{ $t(`settings.sections.${sectionKey}`) }}</h2>
    <v-alert type="info" variant="tonal" :title="$t('common.comingSoon')">{{ $t(`settings.placeholder.${sectionKey}`) }}</v-alert>
  </section>
</template>

<style scoped>
.section-title {
  font-size: 1.6rem;
  margin: 0 0 24px;
}
</style>
