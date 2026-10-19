<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiMagnify } from '@mdi/js'
import type { TitleSort } from '@theama/contracts'
import type { TitlesList } from '@/composables/useTitles'
import PosterGrid from './PosterGrid.vue'

const props = defineProps<{ list: TitlesList; label: string }>()
const { t } = useI18n()

// Refs are destructured so the template can v-model them (and they unwrap as top-level bindings).
const { items, total, nextCursor, loading, loaded, error, q, sort, hideUnavailable, loadMore } = props.list

const SORTS: TitleSort[] = ['title', 'added', 'year']
const sortItems = computed(() => SORTS.map((s) => ({ value: s, title: t(`titles.sort.${s}`) })))
</script>

<template>
  <section>
    <div class="toolbar">
      <v-text-field
        v-model="q"
        :prepend-inner-icon="mdiMagnify"
        :label="$t('titles.filter')"
        clearable
        density="compact"
        class="search"
      />
      <v-select v-model="sort" :items="sortItems" :label="$t('titles.sortBy')" density="compact" class="sort" />
      <v-switch v-model="hideUnavailable" :label="$t('files.hideUnavailable')" color="primary" density="compact" hide-details inset />
      <span class="th-muted count" aria-live="polite">{{ $t('titles.count', total) }}</span>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
    <p v-if="loaded && items.length === 0" class="th-muted none">{{ $t('titles.noMatches') }}</p>
    <PosterGrid v-else :titles="items" :label="label" :has-more="nextCursor !== null" :loading="loading" @load-more="loadMore()" />
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.search {
  flex: 1 1 240px;
  max-width: 380px;
}
.sort {
  flex: 0 1 190px;
}
.count {
  margin-left: auto;
}
.none {
  padding: 48px 0;
  text-align: center;
}
</style>
