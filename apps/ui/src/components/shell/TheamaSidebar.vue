<script setup lang="ts">
import BrandLogo from './BrandLogo.vue'
import ConnectionChip from './ConnectionChip.vue'
import { NAV_ITEMS } from './nav'
</script>

<template>
  <v-navigation-drawer permanent :width="232" color="surface" class="th-hairline sidebar">
    <div class="sidebar__brand">
      <BrandLogo />
    </div>
    <nav :aria-label="$t('nav.main')">
      <v-list nav role="presentation" density="comfortable" bg-color="transparent" class="px-3">
        <v-list-item
          v-for="item in NAV_ITEMS.filter((i) => i.to !== '/settings')"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="$t(item.labelKey)"
          rounded="lg"
          color="primary"
        />
      </v-list>
    </nav>
    <template #append>
      <div class="sidebar__footer">
        <v-list nav role="presentation" density="comfortable" bg-color="transparent" class="px-3">
          <v-list-item
            to="/settings"
            :prepend-icon="NAV_ITEMS.find((i) => i.to === '/settings')?.icon"
            :title="$t('nav.settings')"
            rounded="lg"
            color="primary"
          />
        </v-list>
        <div class="px-5 pb-4"><ConnectionChip /></div>
      </div>
    </template>
  </v-navigation-drawer>
</template>

<style scoped>
.sidebar {
  border-width: 0 1px 0 0;
}
.sidebar__brand {
  padding: 28px 24px 24px;
}
</style>
