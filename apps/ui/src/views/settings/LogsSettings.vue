<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiContentCopy, mdiFolderOpenOutline, mdiRefresh } from '@mdi/js'
import { LOG_LEVEL_ORDER } from '@theama/contracts'
import LogList from '@/components/logs/LogList.vue'
import SearchField from '@/components/common/SearchField.vue'
import { getBridge } from '@/api/bridge'
import { useConnectionStore } from '@/stores/connection'
import { useLogsStore, type RangeKey } from '@/stores/logs'

const { t } = useI18n()
const logs = useLogsStore()
const connection = useConnectionStore()
const bridge = getBridge()
const copied = ref(false)

logs.watchLive()
onMounted(() => void logs.load())
watch(
  () => connection.phase,
  (p) => {
    if (p === 'connected') void logs.load()
  },
)

const levelItems = computed(() => [
  { value: undefined, title: t('common.all') },
  ...LOG_LEVEL_ORDER.map((l) => ({ value: l, title: t(`logs.level.${l}`) })),
])
const sourceItems = computed(() => [
  { value: undefined, title: t('common.all') },
  ...(['app', 'service-stdout', 'service-stderr'] as const).map((s) => ({ value: s, title: t(`logs.source.${s}`) })),
])
const rangeItems = computed(() =>
  (['any', 'hour', 'day', 'week'] as RangeKey[]).map((r) => ({ value: r, title: t(`logs.range.${r}`) })),
)
const serviceSource = computed(() => logs.filters.source === 'service-stdout' || logs.filters.source === 'service-stderr')

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(logs.exportText())
  copied.value = true
}
async function openFolder(): Promise<void> {
  await bridge?.logs.openFolder()
}
</script>

<template>
  <section>
    <h3 class="th-display title">{{ $t('logs.title') }}</h3>
    <p class="th-muted mb-4">{{ $t('logs.description') }}</p>

    <div class="filters th-filter-panel">
      <SearchField v-model="logs.filters.q" :label="$t('logs.filters.search')" class="f-search" :loading="logs.loading" />
      <v-select v-model="logs.filters.level" :items="levelItems" :label="$t('logs.filters.level')" variant="solo-filled" bg-color="surface-bright" hide-details class="f-select" />
      <v-select v-model="logs.filters.source" :items="sourceItems" :label="$t('logs.filters.source')" variant="solo-filled" bg-color="surface-bright" hide-details class="f-select" />
      <v-select v-model="logs.filters.range" :items="rangeItems" :label="$t('logs.filters.range')" variant="solo-filled" bg-color="surface-bright" hide-details class="f-select" />
    </div>

    <div class="toolbar">
      <v-switch
        v-model="logs.live"
        :label="$t('logs.live')"
        color="primary"
        density="compact"
        hide-details
        inset
      />
      <span v-if="logs.live && !logs.liveActive" class="th-muted text-caption">{{ $t('logs.livePaused') }}</span>
      <v-spacer />
      <span class="th-muted text-body-2" aria-live="polite">{{ $t('logs.count', logs.items.length) }}</span>
      <v-btn variant="text" :prepend-icon="mdiRefresh" :loading="logs.loading" @click="logs.load()">{{ $t('common.refresh') }}</v-btn>
      <v-btn variant="text" :prepend-icon="mdiContentCopy" :disabled="logs.items.length === 0" @click="copy">
        {{ copied ? $t('common.copied') : $t('logs.export') }}
      </v-btn>
      <v-btn v-if="bridge" variant="text" :prepend-icon="mdiFolderOpenOutline" @click="openFolder">{{ $t('logs.openFolder') }}</v-btn>
    </div>

    <v-alert v-if="logs.error" type="error" variant="tonal" density="compact" class="mb-3">{{ $t('logs.error') }} {{ logs.error }}</v-alert>
    <v-alert v-if="serviceSource" type="info" variant="tonal" density="compact" class="mb-3">{{ $t('logs.serviceOutputNote') }}</v-alert>

    <p v-if="!logs.loading && logs.items.length === 0" class="th-muted empty">{{ $t('logs.empty') }}</p>
    <LogList v-else :items="logs.items" height="calc(100vh - 430px)" class="list" />

    <div v-if="logs.items.length > 0" class="more">
      <v-btn v-if="logs.hasMore" variant="tonal" :loading="logs.loading" @click="logs.load(true)">{{ $t('logs.loadMore') }}</v-btn>
      <span v-else class="th-muted text-caption">{{ $t('logs.end') }}</span>
    </div>
  </section>
</template>

<style scoped>
.title {
  font-size: 1.25rem;
  margin: 0 0 8px;
}
.filters {
  display: grid;
  grid-template-columns: minmax(220px, 2fr) repeat(3, minmax(140px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.f-search {
  min-width: 0;
}
.f-select {
  min-width: 0;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.list {
  min-height: 260px;
}
.more {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}
.empty {
  padding: 48px 0;
  text-align: center;
}
@media (max-width: 1000px) {
  .filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .f-search {
    grid-column: 1 / -1;
  }
}
@media (max-width: 600px) {
  .filters {
    grid-template-columns: minmax(0, 1fr);
  }
  .f-search {
    grid-column: auto;
  }
}
</style>
