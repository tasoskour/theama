<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import {
  mdiArrowDown,
  mdiClockOutline,
  mdiDotsVertical,
  mdiDownloadOutline,
  mdiFileMultipleOutline,
  mdiHarddisk,
  mdiMagnify,
  mdiMovieOpenOutline,
  mdiPause,
  mdiPlay,
  mdiSortAscending,
  mdiSortDescending,
  mdiTelevisionClassic,
} from '@mdi/js'
import type { DownloadItem } from '@theama/contracts'
import FilesDialog from '@/components/downloads/FilesDialog.vue'
import { BUCKETS, SORT_KEYS, bucket, counts, filterAndSort, totalSpeed } from '@/components/downloads/activeList'
import { useConnectionStore } from '@/stores/connection'
import { useDownloadsStore } from '@/stores/downloads'
import { useDownloadsViewStore } from '@/stores/downloadsView'
import { useSettingsStore } from '@/stores/settings'
import { formatBytes, formatDuration } from '@/utils/format'

defineEmits<{ find: [] }>()

const { t, locale } = useI18n()
const connection = useConnectionStore()
const downloads = useDownloadsStore()
const settings = useSettingsStore()

const items = computed(() => downloads.list?.items ?? [])
const unreachable = computed(() => downloads.list !== null && !downloads.list.reachable && downloads.client?.state !== 'not_configured')

const { activeSearch: search, activeFilter: filter, activeSort: sort, activeDescending: descending } = storeToRefs(useDownloadsViewStore())

const tally = computed(() => counts(items.value))
const shown = computed(() => filterAndSort(items.value, { search: search.value, filter: filter.value, sort: sort.value, descending: descending.value }))
const speed = computed(() => totalSpeed(items.value))
const sortChoices = computed(() => SORT_KEYS.map((key) => ({ value: key, title: t(`downloads.active.sort.${key}`) })))
const filterChoices = computed(() => (['all', ...BUCKETS] as const).filter((f) => f === 'all' || tally.value[f] > 0 || filter.value === f))

function clearFilters(): void {
  search.value = ''
  filter.value = 'all'
}

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

const percent = (item: DownloadItem): number => Math.floor(item.progress * 100)
const moving = (item: DownloadItem): boolean => item.state === 'downloading' && item.downloadSpeed > 0
const speedText = (bytes: number): string => `${formatBytes(bytes, locale.value)}/s`
const kindIcon = (item: DownloadItem): string => (item.kind === 'movie' ? mdiMovieOpenOutline : item.kind === 'series' ? mdiTelevisionClassic : mdiDownloadOutline)
/** What the status chip and the accent bar are coloured by; waiting states stay neutral. */
const tone = (item: DownloadItem): string | undefined => ({ downloading: 'primary', completed: 'success', paused: 'warning', error: 'error' })[item.state as string]
</script>

<template>
  <section :aria-label="$t('downloads.active.heading')" class="active">
    <v-alert v-if="unreachable" type="warning" variant="tonal" density="compact" class="mb-4" data-test="downloads-unreachable">
      {{ $t('downloads.active.unreachable') }}
      <router-link to="/settings/downloads">{{ $t('downloads.active.checkSettings') }}</router-link>
    </v-alert>

    <div class="bar">
      <p v-if="items.length > 0" class="bar__summary" data-test="downloads-summary">
        <strong>{{ $t('downloads.active.summary', tally.all) }}</strong>
        <span v-if="speed > 0" class="th-muted"> · {{ speedText(speed) }}</span>
        <span v-if="tally.finished > 0" class="th-muted"> · {{ $t('downloads.active.summaryFinished', { count: tally.finished }) }}</span>
      </p>
      <v-switch
        :model-value="settings.settings.downloadsShowAll"
        :label="$t('downloads.active.showAll')"
        color="primary"
        density="compact"
        hide-details
        class="bar__switch"
        :disabled="!connection.isConnected"
        data-test="show-all"
        @update:model-value="setShowAll"
      />
    </div>

    <div v-if="items.length > 0" class="tools">
      <v-text-field
        v-model="search"
        :placeholder="$t('downloads.active.search')"
        :aria-label="$t('downloads.active.search')"
        :prepend-inner-icon="mdiMagnify"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="tools__search"
        data-test="downloads-search"
      />
      <div class="tools__sort">
        <v-select v-model="sort" :items="sortChoices" :label="$t('downloads.active.sort.label')" density="compact" variant="outlined" hide-details class="tools__select" data-test="downloads-sort" />
        <v-btn
          :icon="descending ? mdiSortDescending : mdiSortAscending"
          variant="outlined"
          density="comfortable"
          :aria-label="descending ? $t('downloads.active.sortDescending') : $t('downloads.active.sortAscending')"
          data-test="downloads-sort-direction"
          @click="descending = !descending"
        />
      </div>
      <v-chip-group v-model="filter" mandatory column class="tools__chips" data-test="downloads-filters">
        <v-chip v-for="f in filterChoices" :key="f" :value="f" variant="outlined" size="small" filter :data-test="`filter-${f}`">
          {{ $t(`downloads.active.filters.${f}`) }}<span class="chip__count">{{ tally[f] }}</span>
        </v-chip>
      </v-chip-group>
    </div>

    <div v-if="downloads.list && !unreachable && items.length === 0" class="empty" data-test="downloads-empty">
      <v-icon :icon="mdiDownloadOutline" size="40" class="empty__icon" />
      <p>{{ $t('downloads.active.empty') }}</p>
      <v-btn variant="tonal" color="primary" data-test="downloads-find" @click="$emit('find')">{{ $t('downloads.active.findSomething') }}</v-btn>
    </div>

    <div v-else-if="items.length > 0 && shown.length === 0" class="empty" data-test="downloads-no-match">
      <p>{{ $t('downloads.active.noMatches') }}</p>
      <v-btn variant="text" @click="clearFilters">{{ $t('downloads.active.clearFilters') }}</v-btn>
    </div>

    <ul v-if="shown.length > 0" class="cards" role="list" data-test="download-list">
      <li v-for="item in shown" :key="item.hash" class="card" :class="[`card--${bucket(item.state)}`, tone(item) ? `card--${tone(item)}` : '']" :data-hash="item.hash">
        <div class="card__top">
          <v-icon :icon="kindIcon(item)" size="1.25em" class="card__kind" />
          <span class="card__name">{{ item.name }}</span>
          <div class="card__actions">
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
            <v-btn :icon="mdiFileMultipleOutline" variant="text" size="small" :disabled="busy === item.hash" :aria-label="$t('downloads.active.chooseFiles')" data-test="download-choose-files" @click="chooseFiles(item)" />
            <v-menu>
              <template #activator="{ props: menu }">
                <v-btn v-bind="menu" :icon="mdiDotsVertical" variant="text" size="small" :disabled="busy === item.hash" :aria-label="$t('downloads.active.remove')" data-test="download-menu" />
              </template>
              <v-list density="compact">
                <v-list-item :title="$t('downloads.active.keepFiles')" data-test="download-remove" @click="remove(item, false)" />
                <v-list-item :title="$t('downloads.active.deleteFiles')" base-color="error" data-test="download-delete" @click="confirming = item" />
              </v-list>
            </v-menu>
          </div>
        </div>

        <div v-if="item.state !== 'completed'" class="card__progress">
          <v-progress-linear :model-value="percent(item)" :color="tone(item) ?? 'primary'" height="8" rounded :aria-label="`${item.name} ${percent(item)}%`" />
          <span class="card__percent">{{ percent(item) }}%</span>
        </div>

        <div class="card__meta">
          <v-chip :color="tone(item)" size="x-small" label variant="tonal" class="card__state">{{ $t(`downloads.active.state.${item.state}`) }}</v-chip>
          <span v-if="moving(item)" class="stat"><v-icon :icon="mdiArrowDown" size="1em" />{{ speedText(item.downloadSpeed) }}</span>
          <span v-if="item.eta !== null" class="stat"><v-icon :icon="mdiClockOutline" size="1em" />{{ $t('downloads.active.left', { time: formatDuration(item.eta * 1000, locale) }) }}</span>
          <span v-if="item.size > 0" class="stat"><v-icon :icon="mdiHarddisk" size="1em" />{{ formatBytes(item.size, locale) }}</span>
          <v-chip v-if="!item.own" size="x-small" label variant="outlined" data-test="not-ours">{{ $t('downloads.active.notOurs') }}</v-chip>
        </div>
        <p v-if="item.state === 'error'" class="card__problem" data-test="download-problem">{{ item.problem ?? $t('downloads.active.problemUnknown') }}</p>
      </li>
    </ul>

    <FilesDialog v-model="choosingOpen" :item="choosing" @saved="snackbar = $t('downloads.active.files.saved')" />

    <v-dialog :model-value="confirming !== null" max-width="29rem" @update:model-value="confirming = null">
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
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 16px;
  margin-bottom: 8px;
}
.bar__summary {
  margin: 0;
  font-size: 0.95rem;
}
.bar__switch {
  flex: none;
  margin-left: auto;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  margin-bottom: 16px;
}
.tools__search {
  flex: 1 1 15rem;
  min-width: 0;
}
.tools__sort {
  display: flex;
  flex: 1 1 12rem;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.tools__select {
  flex: 1 1 9rem;
  min-width: 9rem;
}
.tools__chips {
  flex: 1 1 100%;
}
.chip__count {
  margin-left: 6px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
.empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 40px 16px;
  text-align: center;
  border: 1px dashed rgba(var(--v-theme-hairline), 0.82);
  border-radius: var(--th-radius-lg);
}
.empty p {
  margin: 0;
}
.empty__icon {
  opacity: 0.5;
}
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 28rem), 1fr));
  gap: 12px;
}
.card {
  --tone: var(--v-theme-on-surface-variant);
  position: relative;
  display: grid;
  gap: 8px;
  padding: 12px 12px 12px 16px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-hairline), 0.82);
  border-radius: var(--th-radius-lg);
  background: rgba(var(--v-theme-surface-light), 0.34);
}
/* The coloured edge is what tells active, paused, finished and failed apart at a glance. */
.card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: rgb(var(--tone));
}
.card--primary {
  --tone: var(--v-theme-primary);
}
.card--success {
  --tone: var(--v-theme-success);
}
.card--warning {
  --tone: var(--v-theme-warning);
}
.card--error {
  --tone: var(--v-theme-error);
  border-color: rgba(var(--v-theme-error), 0.5);
}
/* Done work steps back so what is still moving stands out. */
.card--finished {
  background: transparent;
  opacity: 0.82;
}
.card__top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.card__kind {
  margin-top: 2px;
  opacity: 0.7;
}
.card__name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card__actions {
  display: flex;
  flex: none;
  margin: -0.25rem -0.25rem 0 0;
}
.card__progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card__progress :deep(.v-progress-linear) {
  flex: 1;
}
.card__percent {
  min-width: 3ch;
  text-align: right;
  font-size: 0.85rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  font-size: 0.82rem;
}
.card__problem {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-error));
  overflow-wrap: anywhere;
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-variant-numeric: tabular-nums;
}
</style>
