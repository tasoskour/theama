<script setup lang="ts">
import BrandLogo from './BrandLogo.vue'
import ConnectionChip from './ConnectionChip.vue'
import { NAV_ITEMS } from './nav'
</script>

<template>
  <v-app-bar flat color="surface" height="64" class="th-hairline topnav">
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
          class="topnav__link topnav__interactive"
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
  padding-inline: 10px;
}
.topnav__status {
  flex: 0 0 auto;
  margin-left: auto;
}
.topnav__interactive,
.topnav__interactive :deep(*) {
  -webkit-app-region: no-drag;
}
@media (max-width: 1279px) {
  .topnav__area {
    gap: 8px;
  }
  .topnav__links {
    gap: 0;
  }
  .topnav__link {
    width: 42px;
    height: 42px;
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
