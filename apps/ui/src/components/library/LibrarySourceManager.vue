<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiClose, mdiEyeOffOutline, mdiFolderOpenOutline, mdiFolderPlusOutline, mdiTrashCanOutline } from '@mdi/js'
import type { ExclusionKind, LibrarySource, LibraryType, SourceAvailability } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useAddFolder } from '@/composables/useAddFolder'
import { useLibraryStore } from '@/stores/library'
import { useScansStore } from '@/stores/scans'
import AddSourceDialog from './AddSourceDialog.vue'
import ScanStatus from './ScanStatus.vue'

const { t, d, te } = useI18n()
const library = useLibraryStore()
const scans = useScansStore()
// Opening this page re-checks every drive, so "Offline" is never stale here.
onMounted(async () => {
  await library.load()
  await Promise.all(library.sources.map((source) => library.loadExclusions(source.id)))
})
const flow = useAddFolder()
const bridge = getBridge()
const snackbar = ref<string | null>(null)
const pendingRemoval = ref<LibrarySource | null>(null)
const removeOpen = ref(false)
const exclusionSource = ref<number | null>(null)
const exclusionPath = ref('')
const exclusionKind = ref<ExclusionKind>('folder')
const exclusionBusy = ref(false)

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

async function toggleExclusions(sourceId: number): Promise<void> {
  exclusionSource.value = exclusionSource.value === sourceId ? null : sourceId
  exclusionPath.value = ''
  if (exclusionSource.value !== null) await library.loadExclusions(sourceId)
}

async function browseExclusion(): Promise<void> {
  const picked = await bridge?.pickFolder(t('library.exclusions.pickFolder'))
  if (picked) exclusionPath.value = picked
}

async function addExclusion(sourceId: number): Promise<void> {
  if (!exclusionPath.value.trim() || exclusionBusy.value) return
  exclusionBusy.value = true
  if (await library.addExclusion(sourceId, exclusionPath.value, exclusionKind.value)) {
    exclusionPath.value = ''
    snackbar.value = t('library.exclusions.added')
  }
  exclusionBusy.value = false
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

    <v-alert v-if="scans.status && !scans.ffprobeAvailable" type="warning" variant="tonal" density="compact" class="mb-4">
      {{ $t('scan.ffprobeMissing') }}
    </v-alert>
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
          <ScanStatus :source="s" />
        </div>

        <div class="source__controls">
          <v-select
            :model-value="s.libraryType"
            :items="TYPES.map((v) => ({ value: v, title: $t(`library.types.${v}`) }))"
            :label="$t('library.dialog.type')"
            density="compact"
            hide-details
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
          <v-btn variant="text" size="small" :prepend-icon="mdiEyeOffOutline" @click="toggleExclusions(s.id)">
            {{ $t('library.exclusions.manage') }}
            <v-badge v-if="library.exclusions[s.id]?.length" inline :content="library.exclusions[s.id]?.length ?? 0" color="secondary" />
          </v-btn>
          <v-btn icon variant="text" color="error" :aria-label="`${$t('library.remove')}: ${s.path}`" @click="askRemove(s)">
            <v-icon :icon="mdiTrashCanOutline" />
          </v-btn>
        </div>
        <v-expand-transition>
          <div v-if="exclusionSource === s.id" class="source__exclusions">
            <p class="text-body-2 mb-3">{{ $t('library.exclusions.hint') }}</p>
            <div class="exclusion-form">
              <v-btn-toggle v-model="exclusionKind" mandatory density="compact" color="primary">
                <v-btn value="folder">{{ $t('library.exclusions.folder') }}</v-btn>
                <v-btn value="file">{{ $t('library.exclusions.file') }}</v-btn>
              </v-btn-toggle>
              <v-text-field v-model="exclusionPath" :label="$t('library.exclusions.path')" density="compact" hide-details class="exclusion-path" @keyup.enter="addExclusion(s.id)" />
              <v-btn v-if="bridge && exclusionKind === 'folder'" variant="tonal" :prepend-icon="mdiFolderOpenOutline" @click="browseExclusion">
                {{ $t('library.browse') }}
              </v-btn>
              <v-btn color="primary" variant="tonal" :loading="exclusionBusy" :disabled="!exclusionPath.trim()" @click="addExclusion(s.id)">
                {{ $t('library.exclusions.add') }}
              </v-btn>
            </div>
            <p v-if="!library.exclusions[s.id]?.length" class="th-muted text-caption mt-3 mb-0">{{ $t('library.exclusions.none') }}</p>
            <v-chip
              v-for="e in library.exclusions[s.id] ?? []"
              :key="e.id"
              class="mt-3 mr-2 exclusion-chip th-chip-fixed"
              closable
              :close-icon="mdiClose"
              :title="e.path"
              @click:close="library.removeExclusion(e)"
            >
              {{ e.path }}
            </v-chip>
          </div>
        </v-expand-transition>
      </li>
    </ul>

    <AddSourceDialog :flow="flow" @added="snackbar = $t('library.added')" />

    <v-dialog v-model="removeOpen" max-width="30rem" aria-labelledby="remove-source-title">
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
  flex: 1 1 20rem;
}
/* The full path matters on narrow windows and touch screens, where there is no tooltip. */
.source__path {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
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
.source__exclusions {
  flex: 1 0 100%;
  padding-top: 16px;
  border-top: 1px solid rgb(var(--v-theme-hairline));
}
.exclusion-form {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.exclusion-path {
  flex: 1 1 17rem;
  min-width: 0;
}
.exclusion-chip {
  max-width: min(100%, 40rem);
  height: auto;
  min-height: var(--v-chip-height);
}
.exclusion-chip :deep(.v-chip__content) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type-select {
  min-width: 10.5rem;
}
.empty {
  padding: 32px 0;
}
</style>
