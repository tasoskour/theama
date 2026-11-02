<script setup lang="ts">
import {
  mdiCogOutline,
  mdiBookOpenPageVariantOutline,
  mdiDownloadOutline,
  mdiFolderMultipleOutline,
  mdiMultimedia,
  mdiPlayCircleOutline,
  mdiRenameOutline,
  mdiTuneVariant,
} from '@mdi/js'

const SECTIONS = [
  { to: '/settings/setup', key: 'setup', icon: mdiBookOpenPageVariantOutline },
  { to: '/settings/general', key: 'general', icon: mdiCogOutline },
  { to: '/settings/library', key: 'library', icon: mdiFolderMultipleOutline },
  { to: '/settings/metadata', key: 'metadata', icon: mdiMultimedia },
  { to: '/settings/playback', key: 'playback', icon: mdiPlayCircleOutline },
  { to: '/settings/downloads', key: 'downloads', icon: mdiDownloadOutline },
  { to: '/settings/files', key: 'files', icon: mdiRenameOutline },
  { to: '/settings/advanced', key: 'advanced', icon: mdiTuneVariant },
] as const
</script>

<template>
  <div class="th-page">
    <header class="th-page-header">
      <h1 class="th-display th-page-title">{{ $t('settings.title') }}</h1>
    </header>
    <div class="layout-wrap">
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
  </div>
</template>

<style scoped>
.layout-wrap {
  container: settings / inline-size;
}
.layout {
  display: grid;
  grid-template-columns: minmax(15rem, 17rem) minmax(0, 1fr);
  gap: 32px;
  align-items: start;
}
.sections {
  min-width: 0;
  position: sticky;
  top: 24px;
  /* On a short window or with large text the last item must still be reachable. */
  max-height: calc(100dvh - 3rem - 64px);
  overflow-y: auto;
  padding: 8px;
  border: 1px solid rgba(var(--v-theme-hairline), 0.72);
  border-radius: var(--th-radius-lg);
  background: rgba(var(--v-theme-surface), 0.72);
}
.sections :deep(.v-list-item--active) {
  background: rgba(var(--v-theme-primary), 0.12);
}
.sections :deep(.v-list-item-title) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.content {
  min-width: 0;
  /* Keeps the page from collapsing and re-growing while one section fades out and the next fades in. */
  min-height: 50vh;
}
.content > :deep(section) {
  min-width: 0;
}
/* The width is the page content, measured in text-size units, so large text stacks the menu sooner. */
@container settings (max-width: 52rem) {
  .layout {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .sections {
    position: static;
    max-height: none;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px;
  }
  .sections :deep(.v-list) {
    display: flex;
    gap: 4px;
  }
  /* The strip scrolls sideways; labels stay whole words. */
  .sections :deep(.v-list-item) {
    flex: 0 0 auto;
  }
  .sections :deep(.v-list-item-title) {
    white-space: nowrap;
    overflow-wrap: normal;
  }
}
</style>
