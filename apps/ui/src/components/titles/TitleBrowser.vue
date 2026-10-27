<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiCheckboxMarkedOutline, mdiClose, mdiEyeOffOutline, mdiMovieOpenOutline, mdiRestore, mdiTelevisionClassic, mdiVideoOutline, mdiVectorCombine } from '@mdi/js'
import type { GroupTitlesResult, TitleKind, TitleSort } from '@theama/contracts'
import { useGenres } from '@/composables/useGenres'
import type { TitlesList } from '@/composables/useTitles'
import { commonTitlePrefix } from '@/utils/commonTitle'
import { useLibraryStore } from '@/stores/library'
import { useTitleActionsStore } from '@/stores/titleActions'
import IdentifyDialog from './IdentifyDialog.vue'
import PosterGrid from './PosterGrid.vue'
import GenreFilter from '@/components/common/GenreFilter.vue'
import SearchField from '@/components/common/SearchField.vue'

const props = defineProps<{ list: TitlesList; label: string; kind?: TitleKind }>()
const { t } = useI18n()
const resultsVersion = ref(0)

// Refs are destructured so the template can v-model them (and they unwrap as top-level bindings).
const { items, total, nextCursor, loading, loaded, error, q, sort, genres, genreMode, hideUnavailable, loadMore } = props.list
const { genres: genreItems } = useGenres(() => props.kind)

const SORTS: TitleSort[] = ['title', 'added', 'year']
const sortItems = computed(() => SORTS.map((s) => ({ value: s, title: t(`titles.sort.${s}`) })))
watch(items, (next, previous) => {
  // Only a different result set animates. Appending an infinite-scroll page, refreshing to the same
  // titles, or the first data arriving (the page's own fade covers it) must not remount the grid.
  if (previous.length === 0 && next.length > 0) return
  const sameLead = previous.every((t, i) => next[i]?.key === t.key)
  if (!sameLead) resultsVersion.value++
})

// --- selecting several titles to hide or move together ---------------------------------------
const library = useLibraryStore()
const notices = useTitleActionsStore()
const selecting = ref(false)
const selected = ref<ReadonlySet<string>>(new Set())
const busy = ref(false)
/** undefined: no dialog; null: back to the folder's own setting. */
const confirmKind = ref<TitleKind | null | undefined>(undefined)
const targets: { kind: TitleKind; icon: string; label: string }[] = [
  { kind: 'movie', icon: mdiMovieOpenOutline, label: 'nav.movies' },
  { kind: 'series', icon: mdiTelevisionClassic, label: 'nav.series' },
  { kind: 'video', icon: mdiVideoOutline, label: 'nav.videos' },
]
const groupOpen = ref(false)
const groupKeys = computed(() => [...selected.value])
/** What the selected cards have in common, offered as the series name. */
const groupName = computed(() => commonTitlePrefix(items.value.filter((i) => selected.value.has(i.key)).map((i) => i.title)))
const allSelected = computed(() => items.value.length > 0 && items.value.every((i) => selected.value.has(i.key)))

function toggle(key: string): void {
  const next = new Set(selected.value)
  if (!next.delete(key)) next.add(key)
  selected.value = next
}
/** Drag-selecting sets a card to a given state rather than flipping it, so passing over one twice changes nothing. */
function paint(key: string, on: boolean): void {
  if (selected.value.has(key) === on) return
  const next = new Set(selected.value)
  if (on) next.add(key)
  else next.delete(key)
  selected.value = next
}
function toggleAll(): void {
  selected.value = allSelected.value ? new Set() : new Set(items.value.map((i) => i.key))
}
function stopSelecting(): void {
  selecting.value = false
  selected.value = new Set()
}
// Titles that a refresh or filter removed from view can no longer be seen, so they must not be acted on.
watch(items, (next) => {
  if (selected.value.size === 0) return
  const present = new Set(next.map((i) => i.key))
  const kept = [...selected.value].filter((k) => present.has(k))
  if (kept.length !== selected.value.size) selected.value = new Set(kept)
})

async function hideSelected(): Promise<void> {
  if (busy.value || selected.value.size === 0) return
  busy.value = true
  let done = 0
  for (const key of selected.value) if (await library.hideTitle(key)) done++
  const failed = selected.value.size - done
  notices.notify(failed === 0 ? t('titles.select.hidden', done) : (library.error ?? t('titles.actions.failed')), failed > 0)
  busy.value = false
  stopSelecting()
}

function onGrouped(result: GroupTitlesResult, identifyRequested: boolean): void {
  const count = result.affectedFileCount
  if (identifyRequested && !result.identified) notices.notify(t('titles.select.groupedUnidentified', { count, reason: result.identifyError ?? t('titles.actions.failed') }), true)
  else notices.notify(t(result.identified ? 'titles.select.groupedIdentified' : 'titles.select.grouped', { count }))
  stopSelecting()
}

async function moveSelected(): Promise<void> {
  const kind = confirmKind.value
  if (kind === undefined || busy.value || selected.value.size === 0) return
  confirmKind.value = undefined
  busy.value = true
  let moved = 0
  for (const key of selected.value) if ((await library.reclassifyTitle(key, kind)) !== null) moved++
  const failed = selected.value.size - moved
  const destination = kind ? t(`detail.kind.${kind}`) : t('titles.actions.folderSetting')
  notices.notify(failed === 0 ? t('titles.select.moved', { count: moved, destination }) : (library.error ?? t('titles.actions.failed')), failed > 0)
  busy.value = false
  stopSelecting()
}
</script>

<template>
  <section>
    <div class="toolbar th-filter-panel th-filter-panel--flat" role="search">
      <SearchField
        v-model="q"
        :label="$t('titles.filter')"
        density="compact"
        class="search"
        :loading="loading && !loaded"
      />
      <GenreFilter v-model="genres" v-model:mode="genreMode" :items="genreItems" class="genres" />
      <v-select v-model="sort" :items="sortItems" :label="$t('titles.sortBy')" density="compact" variant="solo-filled" flat bg-color="surface-bright" hide-details class="sort th-search-control" />
      <v-switch v-model="hideUnavailable" :label="$t('files.hideUnavailable')" color="primary" density="compact" hide-details inset class="availability" />
      <v-btn
        :prepend-icon="selecting ? mdiClose : mdiCheckboxMarkedOutline"
        :variant="selecting ? 'tonal' : 'text'"
        size="small"
        class="select-toggle"
        data-test="select-toggle"
        @click="selecting ? stopSelecting() : (selecting = true)"
      >{{ selecting ? $t('common.cancel') : $t('titles.select.start') }}</v-btn>
      <span class="count" aria-live="polite">{{ $t('titles.count', total) }}</span>
      <v-progress-linear v-if="loading && loaded" indeterminate color="primary" height="2" class="toolbar__progress" />
    </div>

    <div v-if="selecting" class="selection th-filter-panel" role="toolbar" :aria-label="$t('titles.select.bar')" data-test="selection-bar">
      <span class="selection__count" aria-live="polite">{{ $t('titles.select.count', selected.size) }}</span>
      <v-btn variant="text" size="small" :disabled="busy || items.length === 0" @click="toggleAll">{{ allSelected ? $t('titles.select.none') : $t('titles.select.all') }}</v-btn>
      <v-spacer />
      <v-btn variant="tonal" size="small" :prepend-icon="mdiVectorCombine" :disabled="busy || selected.size === 0" data-test="selection-group" @click="groupOpen = true">{{ $t('titles.select.group') }}</v-btn>
      <v-menu location="top end">
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" variant="tonal" size="small" :prepend-icon="mdiRestore" :disabled="busy || selected.size === 0" data-test="selection-move">{{ $t('titles.actions.moveTo') }}</v-btn>
        </template>
        <v-list density="compact">
          <v-list-item v-for="target in targets" :key="target.kind" :prepend-icon="target.icon" :title="$t(target.label)" :disabled="kind === target.kind" @click="confirmKind = target.kind" />
          <v-divider />
          <v-list-item :prepend-icon="mdiRestore" :title="$t('titles.actions.folderSetting')" @click="confirmKind = null" />
        </v-list>
      </v-menu>
      <v-btn variant="tonal" size="small" :prepend-icon="mdiEyeOffOutline" :disabled="busy || selected.size === 0" :loading="busy" data-test="selection-hide" @click="hideSelected">{{ $t('titles.actions.hide') }}</v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
    <transition name="results" mode="out-in">
      <div :key="resultsVersion">
        <p v-if="loaded && items.length === 0" class="th-muted none">{{ $t('titles.noMatches') }}</p>
        <PosterGrid v-else :titles="items" :label="label" :has-more="nextCursor !== null" :loading="loading" :selecting="selecting" :selected="selected" @load-more="loadMore()" @toggle="toggle" @paint="paint" />
      </div>
    </transition>

    <IdentifyDialog v-model="groupOpen" kind="series" :group-keys="groupKeys" :initial-query="groupName" :initial-year="null" @grouped="onGrouped" />

    <v-dialog :model-value="confirmKind !== undefined" max-width="31rem" @update:model-value="confirmKind = undefined">
      <v-card>
        <v-card-title>{{ $t('titles.select.moveConfirmTitle', selected.size) }}</v-card-title>
        <v-card-text>{{ $t('titles.select.moveConfirmBody', { count: selected.size, destination: confirmKind ? $t(`detail.kind.${confirmKind}`) : $t('titles.actions.folderSetting') }) }}</v-card-text>
        <v-card-actions class="th-action-row">
          <v-btn variant="text" @click="confirmKind = undefined">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="busy" @click="moveSelected">{{ $t('titles.actions.confirmMove') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 20px;
}
.search {
  flex: 1 1 15rem;
  min-width: 0;
}
.sort {
  flex: 1 1 11rem;
  min-width: 0;
}
.genres {
  flex: 1 1 22rem;
  min-width: min(100%, 18rem);
}
.availability {
  flex: 0 0 auto;
  align-self: center;
  margin-inline: 4px;
}
.select-toggle {
  align-self: center;
}
.selection {
  position: sticky;
  top: 8px;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 8px 12px;
}
.selection__count {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
/* The default inset switch has an off-state track that vanishes into the dark surface; give it an outline. */
.availability :deep(.v-selection-control:not(.v-selection-control--dirty) .v-switch__track) {
  background: rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-hairline), 0.95);
  opacity: 1;
}
.availability :deep(.v-selection-control:not(.v-selection-control--dirty) .v-switch__thumb) {
  background: rgb(var(--v-theme-on-surface-variant));
}
.availability :deep(.v-label) {
  opacity: 1;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.9rem;
  letter-spacing: 0;
}
.count {
  align-self: center;
  margin-left: auto;
  min-width: 0;
  padding-inline: 4px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.toolbar__progress {
  position: absolute;
  right: 12px;
  bottom: 0;
  left: 12px;
  width: auto;
}
.results-enter-active,
.results-leave-active {
  transition: opacity 140ms ease, transform 180ms cubic-bezier(0.2, 0, 0, 1);
}
.results-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.results-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.none {
  padding: 48px 0;
  text-align: center;
}
@media (max-width: 700px) {
  .toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .search {
    grid-column: 1 / -1;
  }
  .genres {
    grid-column: 1 / -1;
  }
  .sort {
    min-width: 0;
  }
  .count {
    margin-left: 0;
  }
}
@media (max-width: 480px) {
  .availability {
    grid-column: 1 / -1;
  }
  .count {
    grid-column: 1 / -1;
  }
}
</style>
