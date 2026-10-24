<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogEntry, LogLevel } from '@theama/contracts'

defineProps<{ items: LogEntry[]; height: number | string }>()

/** Virtual rows need a numeric height, so derive it from the real root font size (text size setting, 4K scaling, browser zoom). */
const rootPx = ref(16)
const rowHeight = computed(() => Math.ceil(rootPx.value * 2.2))
function measure(): void {
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  if (Number.isFinite(size) && size > 0) rootPx.value = size
}
onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => window.removeEventListener('resize', measure))
const { d } = useI18n()
const selected = ref<LogEntry | null>(null)
const open = ref(false)

const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: 'secondary',
  debug: 'secondary',
  info: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'error',
}

function show(entry: LogEntry): void {
  selected.value = entry
  open.value = true
}
</script>

<template>
  <div class="loglist th-hairline" :style="{ height: typeof height === 'number' ? `${height}px` : height, '--row-h': `${rowHeight}px` }">
    <v-virtual-scroll :items="items" :item-height="rowHeight" height="100%">
      <template #default="{ item }">
        <button type="button" class="row" @click="show(item)">
          <span class="time th-mono th-muted">{{ d(new Date(item.time), 'row') }}</span>
          <v-chip :color="LEVEL_COLOR[item.level]" size="x-small" label variant="tonal" class="level">
            {{ $t(`logs.level.${item.level}`) }}
          </v-chip>
          <span v-if="item.source !== 'app'" class="src th-muted">{{ $t(`logs.source.${item.source}`) }}</span>
          <span class="msg th-mono" :title="item.message">{{ item.message }}</span>
        </button>
      </template>
    </v-virtual-scroll>

    <v-dialog v-model="open" max-width="45rem">
      <v-card v-if="selected" class="pa-2">
        <v-card-title class="d-flex align-center ga-3">
          <v-chip :color="LEVEL_COLOR[selected.level]" size="small" label variant="tonal">{{ $t(`logs.level.${selected.level}`) }}</v-chip>
          <span class="text-body-2 th-muted">{{ d(new Date(selected.time), 'short') }}</span>
        </v-card-title>
        <v-card-text>
          <pre class="detail th-mono">{{ selected.message }}</pre>
          <pre v-if="selected.context" class="detail th-mono mt-3">{{ JSON.stringify(selected.context, null, 2) }}</pre>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="open = false">{{ $t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.loglist {
  container-type: inline-size;
  border-radius: var(--th-radius);
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: var(--row-h, 34px);
  padding: 0 12px;
  text-align: left;
  color: inherit;
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgba(var(--v-theme-hairline), 0.5);
  cursor: pointer;
}
.row:hover {
  background: rgb(var(--v-theme-surface-light));
}
.time {
  flex: none;
  min-width: 19ch;
  white-space: nowrap;
}
.level {
  flex: none;
  min-width: 5.5rem;
  justify-content: center;
}
.src {
  flex: none;
  font-size: 0.75rem;
}
.msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
@container (max-width: 42rem) {
  .time {
    display: none;
  }
}
</style>
