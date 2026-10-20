<script setup lang="ts">
import {
  mdiCogOutline,
  mdiFolderMultipleOutline,
  mdiMultimedia,
  mdiPlayCircleOutline,
  mdiRenameOutline,
  mdiTuneVariant,
} from '@mdi/js'

const SECTIONS = [
  { to: '/settings/general', key: 'general', icon: mdiCogOutline },
  { to: '/settings/library', key: 'library', icon: mdiFolderMultipleOutline },
  { to: '/settings/metadata', key: 'metadata', icon: mdiMultimedia },
  { to: '/settings/playback', key: 'playback', icon: mdiPlayCircleOutline },
  { to: '/settings/files', key: 'files', icon: mdiRenameOutline },
  { to: '/settings/advanced', key: 'advanced', icon: mdiTuneVariant },
] as const
</script>

<template>
  <div class="th-page">
    <header class="th-page-header">
      <h1 class="th-display th-page-title">{{ $t('settings.title') }}</h1>
    </header>
    <div class="layout">
      <nav class="sections" :aria-label="$t('settings.title')">
        <v-list nav role="presentation" bg-color="transparent" density="comfortable" class="pa-0">
          <v-list-item
            v-for="s in SECTIONS"
            :key="s.key"
            :to="s.to"
            :prepend-icon="s.icon"
            :title="$t(`settings.sections.${s.key}`)"
            rounded="lg"
            color="primary"
          />
        </v-list>
      </nav>
      <main class="content">
        <router-view v-slot="{ Component, route }">
          <transition name="th-fade" mode="out-in">
            <component :is="Component" :key="route.matched[1]?.path ?? route.path" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 32px;
  align-items: start;
}
.sections {
  position: sticky;
  top: 24px;
  padding: 8px;
  border: 1px solid rgba(var(--v-theme-hairline), 0.72);
  border-radius: var(--th-radius-lg);
  background: rgba(var(--v-theme-surface), 0.72);
}
.sections :deep(.v-list-item--active) {
  background: rgba(var(--v-theme-primary), 0.12);
}
.content {
  min-width: 0;
  /* Keeps the page from collapsing and re-growing while one section fades out and the next fades in. */
  min-height: 50vh;
}
.content > :deep(section) {
  min-width: 0;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .sections {
    position: static;
    overflow-x: auto;
    padding: 4px;
  }
  .sections :deep(.v-list) {
    display: flex;
    gap: 4px;
  }
}
</style>
