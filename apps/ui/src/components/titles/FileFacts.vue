<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiContentCopy, mdiFolderOpenOutline } from '@mdi/js'
import type { MediaFile } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { formatBytes, formatDuration, resolutionLabel } from '@/utils/format'

const props = defineProps<{ file: MediaFile }>()
const { locale, d } = useI18n()
const bridge = getBridge()

const facts = computed(() => {
  const f = props.file
  const rows: [string, string][] = []
  const res = resolutionLabel(f.width, f.height)
  if (res) rows.push(['detail.facts.resolution', f.width && f.height ? `${f.width}×${f.height} (${res})` : res])
  if (f.durationMs !== null) rows.push(['detail.facts.duration', formatDuration(f.durationMs, locale.value)])
  if (f.videoCodec) rows.push(['detail.facts.video', f.videoCodec.toUpperCase()])
  if (f.audioCodecs.length) rows.push(['detail.facts.audio', f.audioCodecs.map((c) => c.toUpperCase()).join(', ')])
  if (f.subtitleCount !== null) rows.push(['detail.facts.subtitles', String(f.subtitleCount)])
  if (f.container) rows.push(['detail.facts.container', f.container])
  rows.push(['detail.facts.size', formatBytes(f.size, locale.value)])
  rows.push(['detail.facts.modified', d(new Date(f.modifiedAt), 'short')])
  return rows
})

async function copyPath(): Promise<void> {
  await navigator.clipboard.writeText(props.file.path)
}
</script>

<template>
  <div class="facts">
    <dl class="grid">
      <template v-for="[key, value] in facts" :key="key">
        <dt>{{ $t(key) }}</dt>
        <dd>{{ value }}</dd>
      </template>
      <dt>{{ $t('detail.facts.path') }}</dt>
      <dd class="path th-mono">{{ file.path }}</dd>
    </dl>
    <p v-if="file.probeError" class="th-muted text-caption error">{{ $t('files.unreadableHint') }} <span class="th-mono">{{ file.probeError }}</span></p>
    <div class="actions">
      <v-btn v-if="bridge" size="small" variant="tonal" :prepend-icon="mdiFolderOpenOutline" :disabled="file.state === 'source_offline'" @click="bridge.showItemInFolder(file.path)">
        {{ $t('detail.openFolder') }}
      </v-btn>
      <v-btn size="small" variant="text" :prepend-icon="mdiContentCopy" @click="copyPath">{{ $t('detail.copyPath') }}</v-btn>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 24px;
  margin: 0;
}
dt {
  color: rgb(var(--v-theme-on-surface-variant));
}
dd {
  margin: 0;
}
.path {
  word-break: break-all;
}
.error {
  margin: 8px 0 0;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
</style>
