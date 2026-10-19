<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_EPISODE_TEMPLATE, DEFAULT_MOVIE_TEMPLATE, OperationBatch, OperationList, TEMPLATE_TOKENS } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'

const { t, d } = useI18n()
const connection = useConnectionStore()
const settings = useSettingsStore()

const movie = ref(settings.settings.renameMovieTemplate)
const episode = ref(settings.settings.renameEpisodeTemplate)
const problem = ref<{ field: 'movie' | 'episode'; message: string } | null>(null)
const snackbar = ref('')
const tokens = TEMPLATE_TOKENS.map((n) => `{${n}}`).join('  ')
/** Shown as an example inside a translated sentence; braces in a message itself would be read as a placeholder. */
const example = '{season:00}'

watch(
  () => settings.settings,
  (s) => {
    movie.value = s.renameMovieTemplate
    episode.value = s.renameEpisodeTemplate
  },
)

async function save(field: 'movie' | 'episode'): Promise<void> {
  problem.value = null
  const ok = await settings.update(field === 'movie' ? { renameMovieTemplate: movie.value.trim() } : { renameEpisodeTemplate: episode.value.trim() })
  if (ok) snackbar.value = t('settings.general.saved')
  else problem.value = { field, message: settings.error ?? t('common.unknown') }
}
function reset(field: 'movie' | 'episode'): void {
  if (field === 'movie') movie.value = DEFAULT_MOVIE_TEMPLATE
  else episode.value = DEFAULT_EPISODE_TEMPLATE
  void save(field)
}

// --- history ------------------------------------------------------------------
const batches = ref<OperationBatch[]>([])
const busy = ref<string | null>(null)
const historyError = ref<string | null>(null)
const open = ref<string | null>(null)

async function load(): Promise<void> {
  if (!connection.client) return
  try {
    batches.value = (await connection.client.get('/files/operations', OperationList, { limit: 30 })).items
    historyError.value = null
  } catch (err) {
    historyError.value = err instanceof Error ? err.message : String(err)
  }
}
watch(() => connection.phase, (p) => p === 'connected' && void load(), { immediate: true })
onScopeDispose(
  connection.onEvent((e) => {
    if (e.type === 'library.changed') void load()
  }),
)

async function undo(b: OperationBatch): Promise<void> {
  if (!connection.client || busy.value) return
  busy.value = b.id
  try {
    const updated = await connection.client.post(`/files/operations/${b.id}/rollback`, {}, OperationBatch)
    batches.value = batches.value.map((x) => (x.id === b.id ? updated : x))
  } catch (err) {
    historyError.value = err instanceof ApiRequestError ? err.message : String(err)
  } finally {
    busy.value = null
  }
}
const fileName = (p: string): string => p.slice(p.lastIndexOf('\\') + 1)
</script>

<template>
  <section>
    <h2 class="th-display section-title">{{ $t('settings.sections.files') }}</h2>
    <p class="intro">{{ $t('files.intro') }}</p>

    <div class="field">
      <span class="label">{{ $t('files.templates') }}</span>
      <form class="tpl" @submit.prevent="save('movie')">
        <v-text-field v-model="movie" :label="$t('rename.movieTemplate')" :error-messages="problem?.field === 'movie' ? problem.message : undefined" spellcheck="false" autocomplete="off" hide-details="auto" data-test="movie-template" />
        <v-btn type="submit" variant="tonal" :disabled="!connection.isConnected">{{ $t('common.save') }}</v-btn>
        <v-btn variant="text" @click="reset('movie')">{{ $t('files.reset') }}</v-btn>
      </form>
      <form class="tpl" @submit.prevent="save('episode')">
        <v-text-field v-model="episode" :label="$t('rename.episodeTemplate')" :error-messages="problem?.field === 'episode' ? problem.message : undefined" spellcheck="false" autocomplete="off" hide-details="auto" data-test="episode-template" />
        <v-btn type="submit" variant="tonal" :disabled="!connection.isConnected">{{ $t('common.save') }}</v-btn>
        <v-btn variant="text" @click="reset('episode')">{{ $t('files.reset') }}</v-btn>
      </form>
      <p class="th-muted hint">{{ $t('rename.tokens', { tokens, example }) }} {{ $t('files.tokenHint') }}</p>
    </div>

    <div class="field">
      <span class="label">{{ $t('files.history') }}</span>
      <p class="th-muted hint">{{ $t('files.historyHint') }}</p>
      <v-alert v-if="historyError" type="error" variant="tonal" density="compact">{{ historyError }}</v-alert>
      <p v-if="batches.length === 0" class="th-muted hint">{{ $t('files.noHistory') }}</p>
      <ul v-else class="batches" role="list" data-test="rename-history">
        <li v-for="b in batches" :key="b.id" class="batch">
          <div class="batch__head">
            <button type="button" class="batch__toggle" :aria-expanded="open === b.id" @click="open = open === b.id ? null : b.id">
              <span class="batch__when">{{ d(new Date(b.createdAt), 'short') }}</span>
              <span class="batch__sum">
                {{ $t('files.batchSummary', { n: b.done + b.rolledBack }) }}
                <span v-if="b.rolledBack > 0" class="th-muted"> · {{ $t('files.batchUndone', { n: b.rolledBack }) }}</span>
                <span v-if="b.failed > 0" class="batch__warn"> · {{ $t('files.batchFailed', { n: b.failed }) }}</span>
              </span>
            </button>
            <v-btn v-if="b.canRollback" size="small" variant="tonal" :loading="busy === b.id" data-test="undo-batch" @click="undo(b)">{{ $t('rename.undo') }}</v-btn>
          </div>
          <ul v-if="open === b.id" class="items" role="list">
            <li v-for="i in b.items" :key="i.id">
              <span class="th-mono">{{ fileName(i.from) }}</span> → <span class="th-mono">{{ fileName(i.to) }}</span>
              <v-chip size="x-small" label variant="tonal" class="ml-2" :color="i.status === 'done' ? 'success' : i.status === 'rolled_back' ? undefined : 'warning'">{{ $t(`files.opStatus.${i.status}`) }}</v-chip>
              <span v-if="i.error" class="th-muted"> {{ i.error }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </div>
    <v-snackbar :model-value="snackbar !== ''" :timeout="2200" color="surface-bright" @update:model-value="snackbar = ''">{{ snackbar }}</v-snackbar>
  </section>
</template>

<style scoped>
.section-title {
  font-size: 1.6rem;
  margin: 0 0 12px;
}
.intro {
  max-width: 62ch;
  margin: 0 0 28px;
}
.field {
  display: grid;
  gap: 12px;
  margin-bottom: 32px;
}
.label {
  font-weight: 600;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  max-width: 70ch;
}
.tpl {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  max-width: 760px;
}
.batches {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
  max-width: 760px;
}
.batch {
  border: 1px solid rgb(var(--v-theme-hairline));
  border-radius: var(--th-radius);
  padding: 8px 12px;
}
.batch__head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.batch__toggle {
  flex: 1;
  display: flex;
  gap: 16px;
  text-align: left;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  padding: 4px 0;
}
.batch__when {
  min-width: 11em;
  opacity: 0.8;
}
.batch__warn {
  color: rgb(var(--v-theme-warning));
}
.items {
  list-style: none;
  margin: 8px 0 4px;
  padding: 0;
  display: grid;
  gap: 4px;
  font-size: 0.82rem;
}
</style>
