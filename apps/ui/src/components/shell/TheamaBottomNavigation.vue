<script setup lang="ts">
import { computed } from 'vue'
import { mdiDotsHorizontal } from '@mdi/js'
import { NAV_ITEMS } from './nav'
import { useSettingsStore } from '@/stores/settings'
import { TEXT_SIZE_SCALE } from '@/theme/textSize'

const bottom = NAV_ITEMS.filter((i) => i.bottom)
const overflow = NAV_ITEMS.filter((i) => !i.bottom)
const settings = useSettingsStore()
// The mobile baseline is 16px; reserve room for an icon and two lines of labels.
const height = computed(() => Math.max(64, Math.ceil(64 * TEXT_SIZE_SCALE[settings.settings.textSize])))
</script>

<template>
  <v-bottom-navigation :height="height" grow color="primary" bg-color="surface" class="th-hairline bottomnav" :aria-label="$t('nav.main')">
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
.bottomnav :deep(.v-btn--active) {
  background: rgba(var(--v-theme-primary), 0.12);
}
.bottomnav :deep(.v-bottom-navigation__content > .v-btn) {
  min-width: 0;
  padding-inline: 4px;
}
.bottomnav :deep(.v-btn__content) {
  max-width: 100%;
}
.label {
  max-width: 100%;
  font-size: 0.68rem;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.2;
}
</style>
