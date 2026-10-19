<script setup lang="ts">
import { mdiDotsHorizontal } from '@mdi/js'
import { NAV_ITEMS } from './nav'

const bottom = NAV_ITEMS.filter((i) => i.bottom)
const overflow = NAV_ITEMS.filter((i) => !i.bottom)
</script>

<template>
  <v-bottom-navigation grow color="primary" bg-color="surface" class="th-hairline bottomnav" :aria-label="$t('nav.main')">
    <v-btn v-for="item in bottom" :key="item.to" :to="item.to" :exact="item.to === '/'" variant="text" :aria-label="$t(item.labelKey)">
      <v-icon :icon="item.icon" />
      <span class="label">{{ $t(item.labelKey) }}</span>
    </v-btn>
    <v-menu location="top end">
      <template #activator="{ props }">
        <v-btn v-bind="props" variant="text" :aria-label="$t('nav.collections') + ' / ' + $t('nav.settings')">
          <v-icon :icon="mdiDotsHorizontal" />
          <span class="label">…</span>
        </v-btn>
      </template>
      <v-list density="comfortable">
        <v-list-item
          v-for="item in overflow"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="$t(item.labelKey)"
        />
      </v-list>
    </v-menu>
  </v-bottom-navigation>
</template>

<style scoped>
.bottomnav {
  border-width: 1px 0 0 0;
}
.label {
  font-size: 0.68rem;
}
</style>
