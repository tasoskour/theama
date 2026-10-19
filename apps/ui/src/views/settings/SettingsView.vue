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
    <header class="mb-6">
      <h1 class="th-display page-title">{{ $t('settings.title') }}</h1>
    </header>
    <div class="layout">
      <nav class="sections" :aria-label="$t('settings.title')">
        <v-list nav bg-color="transparent" density="comfortable" class="pa-0">
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
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped>
.page-title {
  font-size: clamp(2rem, 4vw, 3rem);
  margin: 0;
}
.layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 32px;
  align-items: start;
}
.sections {
  position: sticky;
  top: 24px;
}
.content {
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
  }
  .sections :deep(.v-list) {
    display: flex;
    gap: 4px;
  }
}
</style>
