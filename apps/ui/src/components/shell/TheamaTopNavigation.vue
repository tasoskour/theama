<script setup lang="ts">
import { computed } from 'vue'
import BrandLogo from './BrandLogo.vue'
import ConnectionChip from './ConnectionChip.vue'
import { NAV_ITEMS } from './nav'
import { useRootFontSize } from '@/composables/useRootFontSize'

const rootSize = useRootFontSize()
// 4rem (64px at the base size); grows with the text so the brand and the links keep their room.
const barHeight = computed(() => Math.max(64, Math.ceil(4 * rootSize.value)))
</script>

<template>
  <v-app-bar flat color="surface" :height="barHeight" class="th-hairline topnav">
    <div class="topnav__area">
      <div class="topnav__brand"><BrandLogo :size="32" /></div>
      <nav class="topnav__links" :aria-label="$t('nav.main')">
        <v-btn
          v-for="item in NAV_ITEMS"
          :key="item.to"
          :to="item.to"
          :exact="item.to === '/'"
          :prepend-icon="item.icon"
          :aria-label="$t(item.labelKey)"
          :title="$t(item.labelKey)"
          color="primary"
          variant="text"
          class="topnav__link topnav__interactive th-btn-fixed"
        >
          <span class="topnav__label">{{ $t(item.labelKey) }}</span>
        </v-btn>
      </nav>
      <div class="topnav__status topnav__interactive"><ConnectionChip /></div>
    </div>
  </v-app-bar>
</template>

<style scoped>
.topnav {
  border-width: 0 0 1px 0;
  -webkit-app-region: drag;
}
.topnav__area {
  container: topnav / inline-size;
  width: env(titlebar-area-width, 100%);
  height: 100%;
  margin-left: env(titlebar-area-x, 0);
  padding: 0 12px 0 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.topnav__brand {
  flex: 0 0 auto;
}
.topnav__links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  margin-left: auto;
}
.topnav__link {
  min-width: 0;
  height: 2.75em;
  padding-inline: 10px;
  border-radius: 10px;
}
.topnav__link.v-btn--active {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.topnav__link.v-btn--active::before {
  opacity: 0;
}
.topnav__status {
  flex: 0 0 auto;
  margin-left: auto;
}
.topnav__interactive,
.topnav__interactive :deep(*) {
  -webkit-app-region: no-drag;
}
/* em follows the selected text size, so labels yield to icons before crowding. */
@container topnav (max-width: 90em) {
  .topnav__links {
    gap: 0;
  }
  .topnav__link {
    width: 2.75em;
    height: 2.75em;
    padding: 0;
  }
  .topnav__link :deep(.v-btn__prepend) {
    margin: 0;
  }
  .topnav__label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
}
</style>
