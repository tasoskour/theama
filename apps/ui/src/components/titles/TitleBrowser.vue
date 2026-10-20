<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiMagnify } from '@mdi/js'
import type { TitleSort, TitleSummary } from '@theama/contracts'
import type { TitlesList } from '@/composables/useTitles'
import PosterGrid from './PosterGrid.vue'
import { useLibraryStore } from '@/stores/library'

const props = defineProps<{ list: TitlesList; label: string }>()
const { t } = useI18n()
const library = useLibraryStore()
const notice = ref<string | null>(null)
const resultsVersion = ref(0)

// Refs are destructured so the template can v-model them (and they unwrap as top-level bindings).
const { items, total, nextCursor, loading, loaded, error, q, sort, hideUnavailable, loadMore } = props.list

const SORTS: TitleSort[] = ['title', 'added', 'year']
const sortItems = computed(() => SORTS.map((s) => ({ value: s, title: t(`titles.sort.${s}`) })))
watch(items, (next, previous) => {
  // Appending an infinite-scroll page should not remount the existing grid or steal its keyboard position.
  if (next.length <= previous.length || next[0]?.key !== previous[0]?.key) resultsVersion.value++
})

async function hideTitle(title: TitleSummary): Promise<void> {
  if (await library.hideTitle(title.key)) {
    notice.value = t('titles.hidden', { title: title.title })
    await props.list.reload()
  }
}
</script>

<template>
  <section>
    <div class="toolbar th-filter-panel">
      <v-text-field
        v-model="q"
        :prepend-inner-icon="mdiMagnify"
        :label="$t('titles.filter')"
        clearable
        density="compact"
        variant="solo-filled"
        bg-color="surface-bright"
        hide-details
        autocomplete="off"
        spellcheck="false"
        data-gramm="false"
        class="search th-search-control"
      />
      <v-select v-model="sort" :items="sortItems" :label="$t('titles.sortBy')" density="compact" variant="solo-filled" bg-color="surface-bright" hide-details class="sort" />
      <v-switch v-model="hideUnavailable" :label="$t('files.hideUnavailable')" color="primary" density="compact" hide-details inset class="availability" />
      <span class="count" aria-live="polite">{{ $t('titles.count', total) }}</span>
      <v-progress-linear v-if="loading && loaded" indeterminate color="primary" height="2" class="toolbar__progress" />
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
    <transition name="results" mode="out-in">
      <div :key="resultsVersion">
        <p v-if="loaded && items.length === 0" class="th-muted none">{{ $t('titles.noMatches') }}</p>
        <PosterGrid v-else :titles="items" :label="label" :has-more="nextCursor !== null" :loading="loading" hideable @load-more="loadMore()" @hide="hideTitle" />
      </div>
    </transition>
    <v-snackbar :model-value="notice !== null" :timeout="4000" color="surface-bright" @update:model-value="notice = null">{{ notice }}</v-snackbar>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.search {
  flex: 1 1 300px;
  min-width: min(100%, 240px);
  transition: flex-basis var(--th-motion);
}
.search:focus-within {
  flex-basis: 360px;
}
.sort {
  flex: 0 1 200px;
}
.availability {
  flex: 0 0 auto;
}
.count {
  margin-left: auto;
  padding: 6px 10px;
  border-radius: 999px;
  color: rgb(var(--v-theme-on-surface-variant));
  background: rgb(var(--v-theme-surface-light));
  font-size: 0.82rem;
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
  .search,
  .search:focus-within {
    flex-basis: 100%;
  }
  .sort {
    flex: 1 1 170px;
  }
  .count {
    margin-left: 0;
  }
}
</style>
