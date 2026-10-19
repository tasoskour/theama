<script setup lang="ts">
const TABS = [
  { to: '/settings/advanced/service', key: 'service' },
  { to: '/settings/advanced/logs', key: 'logs' },
  { to: '/settings/advanced/about', key: 'about' },
] as const
</script>

<template>
  <section>
    <h2 class="th-display section-title">{{ $t('settings.sections.advanced') }}</h2>
    <v-tabs color="primary" class="mb-6" :aria-label="$t('settings.sections.advanced')">
      <v-tab v-for="tab in TABS" :key="tab.key" :to="tab.to" :value="tab.to">{{ $t(`settings.advancedTabs.${tab.key}`) }}</v-tab>
    </v-tabs>
    <router-view />
  </section>
</template>

<style scoped>
.section-title {
  font-size: 1.6rem;
  margin: 0 0 16px;
}
</style>
