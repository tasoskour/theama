<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  mdiChevronRight, mdiDeleteOutline, mdiDotsVertical, mdiEyeOffOutline, mdiFolderOpenOutline,
  mdiMovieOpenOutline, mdiRestore, mdiTelevisionClassic, mdiVideoOutline,
} from '@mdi/js'
import {
  ReclassifyTitleResult, RemoveTitleResult, TitleDetail,
  type MediaFile, type TitleKind, type TitleSummary,
} from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useConnectionStore } from '@/stores/connection'
import { useLibraryStore } from '@/stores/library'
import { useTitleActionsStore } from '@/stores/titleActions'

const props = withDefaults(defineProps<{ title: TitleSummary; tabindex?: number }>(), { tabindex: -1 })
const { t } = useI18n()
const connection = useConnectionStore()
const library = useLibraryStore()
const notices = useTitleActionsStore()
const bridge = getBridge()

const open = ref(false)
const detail = ref<TitleDetail | null>(null)
const loadingDetail = ref(false)
const detailError = ref<string | null>(null)
const busy = ref(false)
const confirmKind = ref<TitleKind | null | undefined>(undefined)
const confirmRemove = ref(false)

const files = computed(() => detail.value?.files ?? [])
const targets: { kind: TitleKind; icon: string; label: string }[] = [
  { kind: 'movie', icon: mdiMovieOpenOutline, label: 'nav.movies' },
  { kind: 'series', icon: mdiTelevisionClassic, label: 'nav.series' },
  { kind: 'video', icon: mdiVideoOutline, label: 'nav.videos' },
]

async function loadDetail(): Promise<void> {
  if (detail.value || loadingDetail.value || !connection.client) return
  loadingDetail.value = true
  try {
    detail.value = await connection.client.get('/library/title', TitleDetail, { key: props.title.key })
    detailError.value = null
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loadingDetail.value = false
  }
}

function updateOpen(value: boolean): void {
  open.value = value
  if (value) void loadDetail()
}

function folderDisabled(file: MediaFile): boolean {
  return !bridge || file.state !== 'available'
}

function folderHint(file: MediaFile): string | undefined {
  if (!bridge) return t('titles.actions.desktopOnly')
  if (file.state !== 'available') return t('titles.actions.fileUnavailable')
  return undefined
}

async function showFile(file: MediaFile): Promise<void> {
  if (folderDisabled(file)) return
  open.value = false
  try {
    await bridge!.showItemInFolder(file.path)
  } catch (error) {
    notices.notify(error instanceof Error ? error.message : String(error), true)
  }
}

async function hide(): Promise<void> {
  if (busy.value) return
  open.value = false
  busy.value = true
  const ok = await library.hideTitle(props.title.key)
  notices.notify(ok ? t('titles.hidden', { title: props.title.title }) : (library.error ?? t('titles.actions.failed')), !ok)
  busy.value = false
}

function askReclassify(kind: TitleKind | null): void {
  open.value = false
  confirmKind.value = kind
}

async function reclassify(): Promise<void> {
  if (confirmKind.value === undefined || !connection.client || busy.value) return
  const kind = confirmKind.value
  confirmKind.value = undefined
  busy.value = true
  try {
    const result = await connection.client.post('/library/titles/reclassify', { key: props.title.key, kind }, ReclassifyTitleResult)
    notices.notify(t('titles.actions.moved', { count: result.affectedFileCount, destination: kind ? t(`detail.kind.${kind}`) : t('titles.actions.folderSetting') }))
  } catch (error) {
    notices.notify(error instanceof Error ? error.message : String(error), true)
  } finally {
    busy.value = false
  }
}

async function remove(): Promise<void> {
  if (!connection.client || busy.value) return
  confirmRemove.value = false
  open.value = false
  busy.value = true
  try {
    const result = await connection.client.delete(`/library/titles/${encodeURIComponent(props.title.key)}`, RemoveTitleResult)
    notices.notify(t('titles.actions.removed', { title: props.title.title, count: result.removedFileCount }))
  } catch (error) {
    notices.notify(error instanceof Error ? error.message : String(error), true)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <v-menu :model-value="open" location="bottom end" :close-on-content-click="false" @update:model-value="updateOpen">
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        class="actions-button"
        icon
        size="small"
        variant="flat"
        :tabindex="tabindex"
        :aria-label="$t('titles.actions.menu', { title: title.title })"
        @click.stop
      >
        <v-icon :icon="mdiDotsVertical" size="20" />
      </v-btn>
    </template>

    <v-list class="actions-list" density="compact" nav @click.stop>
      <v-list-subheader>{{ title.title }}</v-list-subheader>
      <v-progress-linear v-if="loadingDetail" indeterminate color="primary" />
      <template v-if="files.length === 1">
        <v-list-item
          :prepend-icon="mdiFolderOpenOutline"
          :disabled="folderDisabled(files[0]!)"
          :title="$t('titles.actions.showInFolder')"
          :subtitle="folderHint(files[0]!)"
          @click="showFile(files[0]!)"
        />
      </template>
      <v-menu v-else-if="files.length > 1" location="end" :close-on-content-click="true">
        <template #activator="{ props: submenuProps }">
          <v-list-item v-bind="submenuProps" :prepend-icon="mdiFolderOpenOutline" :append-icon="mdiChevronRight" :title="$t('titles.actions.showInFolder')" />
        </template>
        <v-list class="file-list" density="compact">
          <v-list-item
            v-for="file in files"
            :key="file.id"
            :disabled="folderDisabled(file)"
            :title="file.fileName"
            :subtitle="folderHint(file)"
            @click="showFile(file)"
          />
        </v-list>
      </v-menu>
      <v-list-item v-else :prepend-icon="mdiFolderOpenOutline" disabled :title="$t('titles.actions.showInFolder')" :subtitle="detailError ?? $t('common.loading')" />

      <v-menu location="end" :close-on-content-click="true">
        <template #activator="{ props: submenuProps }">
          <v-list-item v-bind="submenuProps" :prepend-icon="mdiRestore" :append-icon="mdiChevronRight" :title="$t('titles.actions.moveTo')" />
        </template>
        <v-list density="compact">
          <v-list-item
            v-for="target in targets"
            :key="target.kind"
            :prepend-icon="target.icon"
            :title="$t(target.label)"
            :disabled="title.kind === target.kind"
            @click="askReclassify(target.kind)"
          />
          <v-divider v-if="title.categoryOverride" />
          <v-list-item v-if="title.categoryOverride" :prepend-icon="mdiRestore" :title="$t('titles.actions.folderSetting')" @click="askReclassify(null)" />
        </v-list>
      </v-menu>

      <v-divider />
      <v-list-item :prepend-icon="mdiEyeOffOutline" :title="$t('titles.actions.hide')" :subtitle="$t('titles.actions.hideHint')" @click="hide" />
      <v-list-item class="text-error" :prepend-icon="mdiDeleteOutline" :title="$t('titles.actions.remove')" @click="open = false; confirmRemove = true" />
    </v-list>
  </v-menu>

  <v-dialog :model-value="confirmKind !== undefined" max-width="500" @update:model-value="confirmKind = undefined">
    <v-card>
      <v-card-title>{{ $t('titles.actions.moveConfirmTitle') }}</v-card-title>
      <v-card-text>
        {{ $t('titles.actions.moveConfirmBody', { count: title.fileCount, destination: confirmKind ? $t(`detail.kind.${confirmKind}`) : $t('titles.actions.folderSetting') }) }}
      </v-card-text>
      <v-card-actions class="th-action-row">
        <v-btn variant="text" @click="confirmKind = undefined">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="busy" @click="reclassify">{{ $t('titles.actions.confirmMove') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="confirmRemove" max-width="500">
    <v-card>
      <v-card-title>{{ $t('titles.actions.removeConfirmTitle') }}</v-card-title>
      <v-card-text>{{ $t('titles.actions.removeConfirmBody', { count: title.fileCount }) }}</v-card-text>
      <v-card-actions class="th-action-row">
        <v-btn variant="text" @click="confirmRemove = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="error" variant="flat" :loading="busy" @click="remove">{{ $t('titles.actions.remove') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.actions-button {
  position: absolute;
  z-index: 3;
  top: 8px;
  right: 8px;
  color: #f5efe4;
  background: rgba(15, 14, 12, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(8px);
}
.actions-button:hover,
.actions-button:focus-visible {
  background: rgba(132, 96, 52, 0.96);
}
.actions-list { min-width: 250px; max-width: min(320px, 90vw); }
.file-list { min-width: 260px; max-width: min(420px, 88vw); max-height: 360px; overflow-y: auto; }
</style>
