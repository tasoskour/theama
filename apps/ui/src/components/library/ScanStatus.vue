<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiMagnifyScan, mdiStopCircleOutline } from '@mdi/js'
import type { LibrarySource } from '@theama/contracts'
import { useScansStore } from '@/stores/scans'

const props = defineProps<{ source: LibrarySource }>()
const { t, d } = useI18n()
const scans = useScansStore()

const progress = computed(() => scans.progress[props.source.id])
const active = computed(() => scans.activeFor(props.source.id))
const latest = computed(() => scans.latestFor(props.source.id))
const busy = computed(() => progress.value !== undefined || active.value !== null)
/** Determinate only while FFprobe is working through a known number of files. */
const percent = computed(() => {
  const p = progress.value
  return p && p.phase === 'probing' && p.toProbe > 0 ? Math.round((p.probed / p.toProbe) * 100) : null
})

const liveText = computed(() => {
  const p = progress.value
  if (!p) return t('scan.queued')
  if (p.phase === 'walking') return t('scan.walking', { count: p.found })
  if (p.phase === 'probing') return t('scan.probing', { done: p.probed, total: p.toProbe })
  return t('scan.finalizing')
})

const summaryText = computed(() => {
  const s = latest.value?.summary
  return s ? t('scan.summary', { found: s.found, new: s.new, moved: s.moved, missing: s.missing, errors: s.errors }) : ''
})
</script>

<template>
  <div class="scan" aria-live="polite">
    <template v-if="busy">
      <div class="live">
        <v-progress-linear :model-value="percent ?? 0" :indeterminate="percent === null" color="primary" height="6" rounded class="bar" />
        <span class="text-caption th-muted">{{ liveText }}</span>
      </div>
      <v-btn v-if="active" variant="text" size="small" :prepend-icon="mdiStopCircleOutline" @click="scans.cancel(active.id)">
        {{ $t('scan.cancel') }}
      </v-btn>
    </template>
    <template v-else>
      <div class="result text-caption">
        <span v-if="!latest" class="th-muted">{{ $t('scan.neverScanned') }}</span>
        <template v-else-if="latest.status === 'done'">
          <span v-if="latest.summary.found === 0" class="th-muted">{{ $t('scan.noFiles') }}</span>
          <template v-else>
            <span class="th-muted">{{ summaryText }}</span>
          </template>
          <span v-if="latest.finishedAt" class="th-muted"> · {{ $t('scan.last', { time: d(new Date(latest.finishedAt), 'short') }) }}</span>
        </template>
        <span v-else-if="latest.status === 'failed'" class="text-error">{{ $t('scan.failed') }}</span>
        <span v-else-if="latest.status === 'cancelled'" class="th-muted">{{ $t('scan.cancelled') }}</span>
        <details v-if="latest && latest.diagnostics.length > 0" class="details">
          <summary>{{ $t('scan.details') }} ({{ latest.diagnostics.length }})</summary>
          <ul>
            <li v-for="(line, i) in latest.diagnostics" :key="i" class="th-mono">{{ line }}</li>
          </ul>
        </details>
      </div>
      <v-btn variant="text" size="small" :prepend-icon="mdiMagnifyScan" @click="scans.scanNow(source.id)">{{ $t('scan.now') }}</v-btn>
    </template>
  </div>
</template>

<style scoped>
.scan {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
  width: 100%;
}
.live {
  flex: 1 1 16rem;
  display: grid;
  gap: 4px;
}
.result {
  flex: 1 1 16rem;
  min-width: 0;
}
.details {
  margin-top: 6px;
}
.details summary {
  cursor: pointer;
  color: rgb(var(--v-theme-primary));
}
.details ul {
  margin: 6px 0 0;
  padding-left: 18px;
  max-height: 10rem;
  overflow: auto;
}
</style>
