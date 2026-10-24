<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileSubtitles, SubtitleDownloadResult, SubtitleSearchResults, type MediaFile, type SubtitleProviderId, type SubtitleSearchHit } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'
import { useSubtitlesStore } from '@/stores/subtitles'
import { SUBTITLE_LANGUAGES, subtitleErrorKey, subtitleProviderName } from '@/utils/subtitles'

const props = defineProps<{ file: MediaFile }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ downloaded: [] }>()
const { t, locale } = useI18n()
const connection = useConnectionStore()
const settings = useSettingsStore()
const store = useSubtitlesStore()
const language = ref('el')
const provider = ref<SubtitleProviderId>('opensubtitles')
const title = ref('')
const results = ref<SubtitleSearchHit[]>([])
const existing = ref<FileSubtitles | null>(null)
const busy = ref(false)
const searched = ref(false)
const error = ref('')
const saved = ref('')
const selection = ref<{ resultId: string; files: Extract<SubtitleDownloadResult, { state: 'select' }>['files'] } | null>(null)
let generation = 0
const providerItems = computed(() => store.providers.filter((p) => p.configured).map((p) => ({ title: subtitleProviderName(p.id), value: p.id })))
const languages = computed(() => {
  const names = new Intl.DisplayNames([locale.value], { type: 'language' })
  return SUBTITLE_LANGUAGES.map((code) => ({ value: code, title: names.of(code) ?? code }))
})
async function loadExisting(): Promise<void> {
  if (connection.client) existing.value = await connection.client.get(`/library/files/${props.file.id}/subtitles`, FileSubtitles)
}
watch([open, () => props.file.id], async ([isOpen]) => {
  const current = ++generation
  if (!isOpen) return
  language.value = settings.settings.subtitleLanguages[0] ?? 'el'
  title.value = props.file.title.slice(0, 200)
  results.value = []; selection.value = null; saved.value = ''; error.value = ''; searched.value = false; existing.value = null
  busy.value = true
  try {
    await store.load()
    if (current !== generation) return
    provider.value = providerItems.value.find((p) => p.value === 'opensubtitles')?.value ?? providerItems.value[0]?.value ?? 'opensubtitles'
    await loadExisting()
  } catch (err) { if (current === generation) error.value = t(subtitleErrorKey(err)) }
  finally { if (current === generation) busy.value = false }
})
watch([language, provider, title], () => { results.value = []; searched.value = false; selection.value = null; saved.value = '' })
async function search(): Promise<void> {
  if (!connection.client || busy.value) return
  const current = generation
  busy.value = true; error.value = ''; saved.value = ''; results.value = []; selection.value = null; searched.value = false
  try {
    const response = await connection.client.post(`/library/files/${props.file.id}/subtitles/search`, { provider: provider.value, language: language.value, title: title.value.trim() }, SubtitleSearchResults)
    if (current === generation) { results.value = response.results; searched.value = true }
  } catch (err) { if (current === generation) error.value = t(subtitleErrorKey(err)) }
  finally { if (current === generation) busy.value = false }
}
async function download(resultId: string, entryId?: string): Promise<void> {
  if (!connection.client || busy.value) return
  const current = generation
  busy.value = true; error.value = ''; saved.value = ''
  try {
    const response = await connection.client.post(`/library/files/${props.file.id}/subtitles/download`, { resultId, entryId }, SubtitleDownloadResult)
    if (current !== generation) return
    if (response.state === 'select') selection.value = { resultId, files: response.files }
    else {
      saved.value = response.fileName; selection.value = null
      emit('downloaded')
      await loadExisting()
    }
  } catch (err) { if (current === generation) error.value = t(subtitleErrorKey(err)) }
  finally { if (current === generation) busy.value = false }
}
</script>

<template>
  <v-dialog v-model="open" max-width="55rem" :persistent="busy" aria-labelledby="find-subtitles-title">
    <v-card>
      <v-card-title id="find-subtitles-title">{{ $t('subtitles.find') }}</v-card-title>
      <v-card-text class="content">
        <p class="filename th-mono">{{ file.fileName }}</p>
        <form class="search" @submit.prevent="search">
          <v-select v-model="provider" :items="providerItems" :label="$t('subtitles.provider')" :disabled="busy || !providerItems.length" hide-details />
          <v-select v-model="language" :items="languages" :label="$t('subtitles.language')" :disabled="busy" hide-details />
          <v-text-field v-model="title" :label="$t('subtitles.searchTitle')" :disabled="busy" maxlength="200" hide-details />
          <v-btn type="submit" color="primary" :disabled="busy || !providerItems.length || !title.trim() || !connection.isConnected">{{ $t('subtitles.search') }}</v-btn>
        </form>
        <v-alert v-if="!busy && !providerItems.length" type="info" variant="tonal">
          {{ $t('subtitles.setupHint') }}
          <router-link to="/settings/playback" @click="open = false">{{ $t('subtitles.openSettings') }}</router-link>
        </v-alert>
        <div v-if="existing" class="existing">
          <h3>{{ $t('subtitles.existing') }}</h3>
          <p v-if="!existing.external.length && !existing.embedded.length" class="th-muted">{{ $t('subtitles.noneExisting') }}</p>
          <ul v-else>
            <li v-for="s in existing.external" :key="s.path">{{ s.fileName }} <span v-if="s.forced"> · {{ $t('subtitles.forced') }}</span><span v-if="s.sdh"> · {{ $t('subtitles.sdh') }}</span></li>
            <li v-for="(s, i) in existing.embedded" :key="i">{{ s.language ?? '?' }} · {{ s.codec ?? '' }} · {{ $t('subtitles.embedded') }}</li>
          </ul>
        </div>
        <v-progress-linear v-if="busy" indeterminate :aria-label="$t('subtitles.working')" />
        <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
        <v-alert v-if="saved" type="success" variant="tonal" role="status">{{ $t('subtitles.downloaded', { name: saved }) }}</v-alert>
        <div v-if="selection" class="entries">
          <h3>{{ $t('subtitles.chooseFile') }}</h3>
          <div v-for="entry in selection.files" :key="entry.id" class="result">
            <span class="filename">{{ entry.fileName }}</span>
            <v-btn size="small" variant="tonal" :disabled="busy || !connection.isConnected" @click="download(selection!.resultId, entry.id)">{{ $t('subtitles.download') }}</v-btn>
          </div>
        </div>
        <p v-if="searched && !results.length" role="status">{{ $t('subtitles.noResults') }}</p>
        <p v-if="results.length" class="th-muted">{{ $t('subtitles.matchHint') }}</p>
        <ul v-if="results.length" class="results" :aria-label="$t('subtitles.results')">
          <li v-for="hit in results" :key="hit.id" class="result" data-test="subtitle-result">
            <div>
              <strong class="filename">{{ hit.release }}</strong>
              <p class="metadata">
                {{ hit.language.toUpperCase() }} · {{ hit.format?.toUpperCase() ?? $t('subtitles.unknownFormat') }}
                <span v-if="hit.forced"> · {{ $t('subtitles.forced') }}</span><span v-if="hit.sdh"> · {{ $t('subtitles.sdh') }}</span>
                <span v-if="hit.downloads !== null"> · {{ $t('subtitles.downloadCount', { count: hit.downloads }) }}</span>
                <span v-if="hit.rating !== null"> · {{ $t('subtitles.rating', { value: hit.rating }) }}</span>
              </p>
              <v-chip v-if="hit.hashMatch" size="x-small" label color="success">{{ $t('subtitles.hashMatch') }}</v-chip>
            </div>
            <v-btn size="small" variant="tonal" :disabled="busy || !connection.isConnected" @click="download(hit.id)">{{ $t('subtitles.download') }}</v-btn>
          </li>
        </ul>
      </v-card-text>
      <v-card-actions><v-spacer /><v-btn :disabled="busy" @click="open = false">{{ $t('common.close') }}</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.content { display: grid; gap: 16px; }
.search { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 12px; align-items: center; }
.search > .v-btn { grid-column: 1 / -1; }
.filename { overflow-wrap: anywhere; }
h3 { font-size: 1rem; margin-bottom: 8px; }
p { margin: 0; }
.results { padding: 0; margin: 0; list-style: none; }
.result { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 16px; padding: 12px 0; border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.result > :first-child { flex: 1 1 14rem; min-width: 0; }
.metadata { font-size: .85rem; margin-block: 4px; }
</style>
