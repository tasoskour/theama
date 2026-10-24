<script setup lang="ts">
import { computed } from 'vue'
import { mdiDotsHorizontal } from '@mdi/js'
import { NAV_ITEMS } from './nav'
import { useRootFontSize } from '@/composables/useRootFontSize'

const bottom = NAV_ITEMS.filter((i) => i.bottom)
const overflow = NAV_ITEMS.filter((i) => !i.bottom)
const rootSize = useRootFontSize()
// Room for an icon and two lines of labels: 4rem, from the real computed root size.
const height = computed(() => Math.max(64, Math.ceil(4 * rootSize.value)))
</script>

<template>
  <v-bottom-navigation :height="height" grow color="primary" bg-color="surface" class="th-hairline bottomnav" :aria-label="$t('nav.main')">
    <v-btn v-for="item in bottom" :key="item.to" :to="item.to" :exact="item.to === '/'" variant="text" class="th-btn-fixed" :aria-label="$t(item.labelKey)">
      <v-icon :icon="item.icon" />
      <span class="label">{{ $t(item.labelKey) }}</span>
    </v-btn>
    <v-menu location="top end">
      <template #activator="{ props }">
        <v-btn v-bind="props" variant="text" class="th-btn-fixed" :aria-label="$t('nav.collections') + ' / ' + $t('nav.settings')">
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
  height: 100%;
  padding-inline: 4px;
}
.bottomnav :deep(.v-btn__content) {
  max-width: 100%;
}
.label {
  max-width: 100%;
  /* Six labels share the width: shrink a little on the narrowest windows so short words fit whole. */
  font-size: clamp(0.58rem, 3.4vw, 0.68rem);
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.2;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
