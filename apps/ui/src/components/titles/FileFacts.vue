<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiContentCopy, mdiFolderOpenOutline } from '@mdi/js'
import { FileSubtitles, type MediaFile } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useConnectionStore } from '@/stores/connection'
import { formatBytes, formatDuration, resolutionLabel } from '@/utils/format'

const props = defineProps<{ file: MediaFile }>()
const { locale, d } = useI18n()
const bridge = getBridge()
const connection = useConnectionStore()

/** Subtitle files next to the video are read from disk when asked, so a file added since the last scan shows up. */
const subtitles = ref<FileSubtitles | null>(null)
async function loadSubtitles(): Promise<void> {
  if (!connection.client) return
  try {
    subtitles.value = await connection.client.get(`/library/files/${props.file.id}/subtitles`, FileSubtitles)
  } catch {
    subtitles.value = null
  }
}
onMounted(loadSubtitles)
watch(() => props.file.id, loadSubtitles)

const names = computed(() => {
  try {
    return new Intl.DisplayNames([locale.value], { type: 'language' })
  } catch {
    return null
  }
})
/** `el` -> Greek / Ελληνικά, by the app language; an unknown tag is shown as written. */
function language(code: string | null): string {
  if (!code) return ''
  try {
    return names.value?.of(code) ?? code
  } catch {
    return code
  }
}
const audioLine = (t: MediaFile['audioTracks'][number]): string =>
  [language(t.language), t.title, t.codec?.toUpperCase(), t.channels ? `${t.channels}ch` : null].filter(Boolean).join(' · ')
const embeddedLine = (t: MediaFile['subtitleTracks'][number]): string =>
  [language(t.language), t.title, t.codec, t.forced ? 'forced' : null, t.default ? 'default' : null].filter(Boolean).join(' · ')

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
    <div v-if="file.audioTracks.length" class="tracks" data-test="audio-tracks">
      <h4 class="th-eyebrow">{{ $t('detail.facts.audioTracks') }}</h4>
      <ul>
        <li v-for="(t, i) in file.audioTracks" :key="i">{{ audioLine(t) || $t('common.unknown') }}</li>
      </ul>
    </div>
    <div v-if="subtitles && (subtitles.embedded.length || subtitles.external.length)" class="tracks" data-test="subtitle-tracks">
      <h4 class="th-eyebrow">{{ $t('detail.facts.subtitleFiles') }}</h4>
      <ul>
        <li v-for="(t, i) in subtitles.embedded" :key="`e${i}`">{{ embeddedLine(t) || $t('common.unknown') }} <span class="th-muted">· {{ $t('detail.facts.insideFile') }}</span></li>
        <li v-for="s in subtitles.external" :key="s.path" :class="{ 'tracks__chosen': subtitles.chosen?.path === s.path }">
          {{ language(s.language) || $t('detail.facts.languageUnknown') }}<span v-if="s.forced"> · forced</span><span v-if="s.sdh"> · SDH</span>
          <span class="th-muted th-mono"> · {{ s.fileName }}</span>
          <v-chip v-if="subtitles.chosen?.path === s.path" size="x-small" label variant="tonal" color="primary" class="ml-2">{{ $t('detail.facts.usedWhenPlaying') }}</v-chip>
        </li>
      </ul>
    </div>
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
.tracks {
  margin-top: 14px;
}
.tracks h4 {
  margin: 0 0 6px;
}
.tracks ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 2px;
  font-size: 0.9rem;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
</style>
