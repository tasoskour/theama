<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiDotsVertical, mdiPause, mdiPlay } from '@mdi/js'
import type { DownloadItem } from '@theama/contracts'
import FilesDialog from '@/components/downloads/FilesDialog.vue'
import { useConnectionStore } from '@/stores/connection'
import { useDownloadsStore } from '@/stores/downloads'
import { useSettingsStore } from '@/stores/settings'
import { formatBytes, formatDuration } from '@/utils/format'

const { t, locale } = useI18n()
const connection = useConnectionStore()
const downloads = useDownloadsStore()
const settings = useSettingsStore()

const items = computed(() => downloads.list?.items ?? [])
const unreachable = computed(() => downloads.list !== null && !downloads.list.reachable && downloads.client?.state !== 'not_configured')

const busy = ref<string | null>(null)
const snackbar = ref('')
const confirming = ref<DownloadItem | null>(null)
const choosing = ref<DownloadItem | null>(null)
const choosingOpen = ref(false)

function chooseFiles(item: DownloadItem): void {
  choosing.value = item
  choosingOpen.value = true
}

async function setShowAll(on: boolean | null): Promise<void> {
  await settings.update({ downloadsShowAll: on === true })
  await downloads.load()
}

async function run(item: DownloadItem, action: () => Promise<{ ok: true } | { ok: false; message: string }>, done?: string): Promise<void> {
  busy.value = item.hash
  const res = await action()
  busy.value = null
  snackbar.value = res.ok ? (done ?? '') : t('downloads.active.failed', { message: res.message })
}

const toggle = (item: DownloadItem) => run(item, () => downloads.setPaused(item.hash, item.state !== 'paused'))
const remove = (item: DownloadItem, deleteFiles: boolean) => run(item, () => downloads.remove(item.hash, deleteFiles), t('downloads.active.removed'))

function confirmDelete(): void {
  const item = confirming.value
  confirming.value = null
  if (item) void remove(item, true)
}

function detail(item: DownloadItem): string {
  const parts = [t(`downloads.active.state.${item.state}`)]
  if (item.state === 'downloading' && item.downloadSpeed > 0) parts.push(`${formatBytes(item.downloadSpeed, locale.value)}/s`)
  if (item.eta !== null) parts.push(t('downloads.active.left', { time: formatDuration(item.eta * 1000, locale.value) }))
  if (item.size > 0) parts.push(formatBytes(item.size, locale.value))
  return parts.join(' · ')
}
const percent = (item: DownloadItem): number => Math.floor(item.progress * 100)
const barColor = (item: DownloadItem): string => (item.state === 'error' ? 'error' : item.state === 'completed' ? 'success' : 'primary')
</script>

<template>
  <section aria-labelledby="active-heading" class="active">
    <h2 id="active-heading" class="th-display active__title">{{ $t('downloads.active.heading') }}</h2>
    <v-switch
      :model-value="settings.settings.downloadsShowAll"
      :label="$t('downloads.active.showAll')"
      :hint="$t('downloads.active.showAllHint')"
      persistent-hint
      color="primary"
      density="compact"
      class="mb-4"
      :disabled="!connection.isConnected"
      data-test="show-all"
      @update:model-value="setShowAll"
    />

    <v-alert v-if="unreachable" type="warning" variant="tonal" density="compact" class="mb-4" data-test="downloads-unreachable">
      {{ $t('downloads.active.unreachable') }}
      <router-link to="/settings/downloads">{{ $t('downloads.active.checkSettings') }}</router-link>
    </v-alert>

    <p v-else-if="downloads.list && items.length === 0" class="th-muted" data-test="downloads-empty">{{ $t('downloads.active.empty') }}</p>

    <ul v-if="items.length > 0" class="rows" role="list" data-test="download-list">
      <li v-for="item in items" :key="item.hash" class="row" :data-hash="item.hash">
        <div class="row__main">
          <span class="row__name">{{ item.name }}<v-chip v-if="!item.own" size="x-small" label variant="outlined" class="ml-2" data-test="not-ours">{{ $t('downloads.active.notOurs') }}</v-chip></span>
          <v-progress-linear :model-value="percent(item)" :color="barColor(item)" height="6" rounded :aria-label="`${item.name} ${percent(item)}%`" />
          <span class="row__detail th-muted">{{ percent(item) }}% · {{ detail(item) }}</span>
        </div>
        <div class="row__actions">
          <v-btn
            v-if="item.state !== 'completed'"
            :icon="item.state === 'paused' ? mdiPlay : mdiPause"
            variant="text"
            size="small"
            :loading="busy === item.hash"
            :aria-label="item.state === 'paused' ? $t('downloads.active.resume') : $t('downloads.active.pause')"
            data-test="download-toggle"
            @click="toggle(item)"
          />
          <v-menu>
            <template #activator="{ props: menu }">
              <v-btn v-bind="menu" :icon="mdiDotsVertical" variant="text" size="small" :disabled="busy === item.hash" :aria-label="$t('downloads.active.remove')" data-test="download-menu" />
            </template>
            <v-list density="compact">
              <v-list-item :title="$t('downloads.active.chooseFiles')" data-test="download-choose-files" @click="chooseFiles(item)" />
              <v-list-item :title="$t('downloads.active.keepFiles')" data-test="download-remove" @click="remove(item, false)" />
              <v-list-item :title="$t('downloads.active.deleteFiles')" base-color="error" data-test="download-delete" @click="confirming = item" />
            </v-list>
          </v-menu>
        </div>
      </li>
    </ul>

    <FilesDialog v-model="choosingOpen" :item="choosing" @saved="snackbar = $t('downloads.active.files.saved')" />

    <v-dialog :model-value="confirming !== null" max-width="460" @update:model-value="confirming = null">
      <v-card v-if="confirming">
        <v-card-title class="th-display">{{ $t('downloads.active.confirmDeleteTitle') }}</v-card-title>
        <v-card-text>{{ $t('downloads.active.confirmDeleteBody', { name: confirming.name }) }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirming = null">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" data-test="download-delete-confirm" @click="confirmDelete">{{ $t('downloads.active.deleteFiles') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar :model-value="snackbar !== ''" :timeout="3000" color="surface-bright" @update:model-value="snackbar = ''">{{ snackbar }}</v-snackbar>
  </section>
</template>

<style scoped>
.active {
  max-width: 820px;
  margin-bottom: 40px;
}
.active__title {
  font-size: 1.35rem;
  margin: 0 0 12px;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--v-theme-hairline), 0.72);
}
.row__main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 6px;
}
.row__name {
  overflow-wrap: anywhere;
  font-weight: 500;
}
.row__detail {
  font-size: 0.82rem;
}
.row__actions {
  display: flex;
  flex: none;
}
</style>
