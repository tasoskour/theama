<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TitleKind, TitleSort } from '@theama/contracts'
import { useGenres } from '@/composables/useGenres'
import type { TitlesList } from '@/composables/useTitles'
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
  // Appending an infinite-scroll page should not remount the existing grid or steal its keyboard position.
  if (next.length <= previous.length || next[0]?.key !== previous[0]?.key) resultsVersion.value++
})

</script>

<template>
  <section>
    <div class="toolbar th-filter-panel" role="search">
      <SearchField
        v-model="q"
        :label="$t('titles.filter')"
        density="compact"
        class="search"
        :loading="loading && !loaded"
      />
      <GenreFilter v-model="genres" v-model:mode="genreMode" :items="genreItems" class="genres" />
      <v-select v-model="sort" :items="sortItems" :label="$t('titles.sortBy')" density="compact" variant="solo-filled" bg-color="surface-bright" hide-details class="sort" />
      <v-switch v-model="hideUnavailable" :label="$t('files.hideUnavailable')" color="primary" density="compact" hide-details inset class="availability" />
      <span class="count" aria-live="polite">{{ $t('titles.count', total) }}</span>
      <v-progress-linear v-if="loading && loaded" indeterminate color="primary" height="2" class="toolbar__progress" />
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
    <transition name="results" mode="out-in">
      <div :key="resultsVersion">
        <p v-if="loaded && items.length === 0" class="th-muted none">{{ $t('titles.noMatches') }}</p>
        <PosterGrid v-else :titles="items" :label="label" :has-more="nextCursor !== null" :loading="loading" @load-more="loadMore()" />
      </div>
    </transition>
  </section>
</template>

<style scoped>
.toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(300px, 400px) minmax(170px, 210px) auto auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}
.search {
  min-width: 0;
}
.sort {
  min-width: 0;
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
  .toolbar {
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
</style>
