<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiFolderPlusOutline, mdiTrashCanOutline } from '@mdi/js'
import type { LibrarySource, LibraryType, SourceAvailability } from '@theama/contracts'
import { useAddFolder } from '@/composables/useAddFolder'
import { useLibraryStore } from '@/stores/library'
import AddSourceDialog from './AddSourceDialog.vue'

const { t, d, te } = useI18n()
const library = useLibraryStore()
const flow = useAddFolder()
const snackbar = ref<string | null>(null)
const pendingRemoval = ref<LibrarySource | null>(null)
const removeOpen = ref(false)

const TYPES: LibraryType[] = ['movies', 'series', 'videos', 'auto']
const STATUS_COLOR: Record<SourceAvailability, string> = { online: 'success', offline: 'error', unknown: 'secondary' }

async function change(source: LibrarySource, patch: Parameters<typeof library.update>[1]): Promise<void> {
  const result = await library.update(source.id, patch)
  if (!result.ok) snackbar.value = te(`library.errors.${result.code}`) ? t(`library.errors.${result.code}`) : result.message
}

function askRemove(source: LibrarySource): void {
  pendingRemoval.value = source
  removeOpen.value = true
}

async function confirmRemove(): Promise<void> {
  const source = pendingRemoval.value
  removeOpen.value = false
  if (source && (await library.remove(source.id))) snackbar.value = t('library.removed')
}
</script>

<template>
  <section>
    <div class="head">
      <div>
        <h2 class="th-display title">{{ $t('library.title') }}</h2>
        <p class="th-muted desc">{{ $t('library.description') }}</p>
      </div>
      <v-btn color="primary" :prepend-icon="mdiFolderPlusOutline" @click="flow.begin()">{{ $t('library.add') }}</v-btn>
    </div>

    <v-alert type="info" variant="tonal" density="compact" class="mb-4">{{ $t('library.scanNotice') }}</v-alert>
    <v-alert v-if="library.error" type="error" variant="tonal" density="compact" class="mb-4">{{ library.error }}</v-alert>

    <p v-if="library.loaded && library.sources.length === 0" class="th-muted empty">{{ $t('library.empty') }}</p>

    <ul class="sources" :aria-label="$t('library.title')">
      <li v-for="s in library.sources" :key="s.id" class="source th-hairline" :class="{ 'source--offline': s.availability === 'offline' }">
        <div class="source__main">
          <div class="source__path th-mono" :title="s.path">{{ s.path }}</div>
          <div class="source__meta">
            <v-chip :color="STATUS_COLOR[s.availability]" size="small" label variant="tonal">{{ $t(`library.status.${s.availability}`) }}</v-chip>
            <span v-if="s.lastSeenOnlineAt && s.availability === 'offline'" class="th-muted text-caption">
              {{ $t('library.lastSeen', { time: d(new Date(s.lastSeenOnlineAt), 'short') }) }}
            </span>
            <v-chip v-if="!s.enabled" size="small" label variant="outlined">{{ $t('library.paused') }}</v-chip>
          </div>
          <p v-if="s.availability === 'offline'" class="th-muted text-caption offline-note">{{ $t('library.offlineNote') }}</p>
        </div>

        <div class="source__controls">
          <v-select
            :model-value="s.libraryType"
            :items="TYPES.map((v) => ({ value: v, title: $t(`library.types.${v}`) }))"
            :label="$t('library.dialog.type')"
            density="compact"
            class="type-select"
            @update:model-value="(v: LibraryType) => change(s, { libraryType: v })"
          />
          <v-switch
            :model-value="s.recursive"
            :label="$t('library.recursiveShort')"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="(v: boolean | null) => change(s, { recursive: v === true })"
          />
          <v-switch
            :model-value="s.enabled"
            :label="$t('library.watch')"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="(v: boolean | null) => change(s, { enabled: v === true })"
          />
          <v-btn icon variant="text" color="error" :aria-label="`${$t('library.remove')}: ${s.path}`" @click="askRemove(s)">
            <v-icon :icon="mdiTrashCanOutline" />
          </v-btn>
        </div>
      </li>
    </ul>

    <AddSourceDialog :flow="flow" @added="snackbar = $t('library.added')" />

    <v-dialog v-model="removeOpen" max-width="480" aria-labelledby="remove-source-title">
      <v-card class="pa-2">
        <v-card-title id="remove-source-title" class="th-display">{{ $t('library.removeTitle') }}</v-card-title>
        <v-card-text>
          <p class="th-mono mb-3">{{ pendingRemoval?.path }}</p>
          <p>{{ $t('library.removeBody') }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="removeOpen = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" @click="confirmRemove">{{ $t('library.removeConfirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar :model-value="snackbar !== null" :timeout="3000" color="surface-bright" @update:model-value="snackbar = null">{{ snackbar }}</v-snackbar>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.title {
  font-size: 1.6rem;
  margin: 0 0 4px;
}
.desc {
  margin: 0;
  max-width: 60ch;
}
.sources {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}
.source {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  padding: 16px;
  border-radius: var(--th-radius);
  background: rgb(var(--v-theme-surface));
}
.source--offline {
  border-style: dashed;
}
.source__main {
  min-width: 0;
  flex: 1 1 320px;
}
.source__path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 8px;
}
.source__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.offline-note {
  margin: 8px 0 0;
}
.source__controls {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.type-select {
  min-width: 170px;
}
.empty {
  padding: 32px 0;
}
</style>
