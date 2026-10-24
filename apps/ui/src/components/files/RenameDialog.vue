<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiArrowRight } from '@mdi/js'
import { OperationBatch, RenameApplyResult, RenamePreview, TEMPLATE_TOKENS, type RenameItem } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{ titleKey: string; kind: 'movie' | 'series' }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ renamed: [] }>()

const { t } = useI18n()
const connection = useConnectionStore()
const settings = useSettingsStore()

const movieTemplate = ref('')
const episodeTemplate = ref('')
const items = ref<RenameItem[]>([])
const counts = ref<Record<string, number>>({})
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const applying = ref(false)
const error = ref<string | null>(null)
const result = ref<OperationBatch | null>(null)
const undone = ref(false)

const template = computed({
  get: () => (props.kind === 'movie' ? movieTemplate.value : episodeTemplate.value),
  set: (v: string) => {
    if (props.kind === 'movie') movieTemplate.value = v
    else episodeTemplate.value = v
  },
})
const body = (): Record<string, unknown> => ({
  keys: [props.titleKey],
  ...(props.kind === 'movie' ? { movieTemplate: movieTemplate.value.trim() } : { episodeTemplate: episodeTemplate.value.trim() }),
})

const idOf = (i: RenameItem): string => `${i.from}\u0000${i.to}`
const renamable = computed(() => items.value.filter((i) => i.status === 'ok'))
const chosen = computed(() => renamable.value.filter((i) => selected.value.has(idOf(i))))

function failure(err: unknown): string {
  if (err instanceof ApiRequestError) return err.code === 'invalid_template' ? err.message : err.message
  return err instanceof Error ? err.message : String(err)
}

async function loadPreview(): Promise<void> {
  if (!connection.client) return
  loading.value = true
  error.value = null
  try {
    const p = await connection.client.post('/files/rename/preview', body(), RenamePreview)
    items.value = p.items
    counts.value = p.counts
    selected.value = new Set(p.items.filter((i) => i.status === 'ok').map(idOf))
  } catch (err) {
    items.value = []
    counts.value = {}
    error.value = failure(err)
  } finally {
    loading.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  movieTemplate.value = settings.settings.renameMovieTemplate
  episodeTemplate.value = settings.settings.renameEpisodeTemplate
  result.value = null
  undone.value = false
  void loadPreview()
})

function toggle(i: RenameItem, on: boolean | null): void {
  const next = new Set(selected.value)
  if (on) next.add(idOf(i))
  else next.delete(idOf(i))
  selected.value = next
}

async function apply(): Promise<void> {
  if (!connection.client || chosen.value.length === 0) return
  applying.value = true
  error.value = null
  try {
    const r = await connection.client.post('/files/rename/apply', { ...body(), approved: chosen.value.map((i) => ({ from: i.from, to: i.to })) }, RenameApplyResult)
    result.value = r.batch
    if (!r.batch) error.value = t('rename.nothingChanged')
    emit('renamed')
  } catch (err) {
    error.value = failure(err)
  } finally {
    applying.value = false
  }
}

async function undo(): Promise<void> {
  if (!connection.client || !result.value) return
  applying.value = true
  try {
    result.value = await connection.client.post(`/files/operations/${result.value.id}/rollback`, {}, OperationBatch)
    undone.value = true
    emit('renamed')
  } catch (err) {
    error.value = failure(err)
  } finally {
    applying.value = false
  }
}

const STATUS_COLOR: Record<string, string | undefined> = { ok: undefined, unchanged: undefined, collision_exists: 'warning', collision_batch: 'warning', too_long: 'warning', unavailable: 'warning', missing: 'error', skipped: undefined }
const tokens = TEMPLATE_TOKENS.map((n) => `{${n}}`).join('  ')
/** Shown as an example inside a translated sentence; braces in a message itself would be read as a placeholder. */
const example = '{season:00}'
</script>

<template>
  <v-dialog v-model="open" max-width="54rem" scrollable aria-labelledby="rename-dialog-title">
    <v-card class="pa-2">
      <v-card-title id="rename-dialog-title" class="th-display">{{ $t('rename.title') }}</v-card-title>
      <v-card-text>
        <!-- Step 1: choose and check -->
        <template v-if="!result">
          <p class="th-muted lead">{{ $t('rename.lead') }}</p>
          <form class="tpl" @submit.prevent="loadPreview">
            <v-text-field
              v-model="template"
              :label="$t(kind === 'movie' ? 'rename.movieTemplate' : 'rename.episodeTemplate')"
              :hint="$t('rename.tokens', { tokens, example })"
              persistent-hint
              spellcheck="false"
              autocomplete="off"
              data-test="rename-template"
            />
            <v-btn type="submit" variant="tonal" :loading="loading">{{ $t('rename.update') }}</v-btn>
          </form>

          <v-alert v-if="error" type="warning" variant="tonal" density="compact" class="mt-4">{{ error }}</v-alert>

          <p v-if="!loading && items.length === 0 && !error" class="th-muted mt-4">{{ $t('rename.nothing') }}</p>

          <ul v-if="items.length" class="rows" role="list" :aria-label="$t('rename.title')" data-test="rename-rows">
            <li v-for="i in items" :key="idOf(i)" class="row" :class="{ 'row--sub': i.kind === 'subtitle', 'row--off': i.status !== 'ok' }">
              <v-checkbox-btn
                v-if="i.status === 'ok'"
                :model-value="selected.has(idOf(i))"
                :aria-label="$t('rename.include', { name: i.fromName })"
                density="compact"
                @update:model-value="(v: boolean | null) => toggle(i, v)"
              />
              <span v-else class="row__gap" aria-hidden="true" />
              <div class="row__names">
                <span class="th-mono row__from" :title="i.from">{{ i.fromName }}</span>
                <template v-if="i.status !== 'unchanged' && i.status !== 'skipped' && i.status !== 'unavailable' && i.status !== 'missing'">
                  <svg class="row__arrow th-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiArrowRight" fill="currentColor" /></svg>
                  <span class="th-mono row__to" :title="i.to">{{ i.toName }}</span>
                </template>
              </div>
              <v-chip v-if="i.kind === 'subtitle'" size="x-small" label variant="outlined">{{ $t('rename.subtitle') }}</v-chip>
              <v-chip v-if="i.status !== 'ok'" size="x-small" label variant="tonal" :color="STATUS_COLOR[i.status]" :title="$t(`rename.statusHint.${i.status}`)">{{ $t(`rename.status.${i.status}`) }}</v-chip>
            </li>
          </ul>
          <p class="th-muted note">{{ $t('rename.safety') }}</p>
        </template>

        <!-- Step 2: what happened, and the way back -->
        <template v-else>
          <v-alert :type="undone ? 'info' : result.failed > 0 ? 'warning' : 'success'" variant="tonal" density="comfortable" data-test="rename-result">
            <template v-if="undone">{{ $t('rename.undone', result.rolledBack) }}<span v-if="result.failed > 0"> {{ $t('rename.undoneSome', { n: result.failed }) }}</span></template>
            <template v-else>{{ $t('rename.done', result.done) }}<span v-if="result.failed > 0"> {{ $t('rename.failedSome', { n: result.failed }) }}</span></template>
          </v-alert>
          <ul v-if="result.items.some((x) => x.error)" class="rows mt-4" role="list">
            <li v-for="x in result.items.filter((y) => y.error)" :key="x.id" class="row">
              <div class="row__names"><span class="th-mono row__from" :title="x.from">{{ x.from.split('\\').pop() }}</span></div>
              <span class="th-muted">{{ x.error }}</span>
            </li>
          </ul>
        </template>
      </v-card-text>

      <v-card-actions>
        <span v-if="!result && items.length" class="th-muted summary" aria-live="polite">{{ $t('rename.summary', { chosen: chosen.length, total: items.length }) }}</span>
        <v-spacer />
        <template v-if="!result">
          <v-btn variant="text" @click="open = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="applying" :disabled="chosen.length === 0" data-test="rename-apply" @click="apply">{{ $t('rename.apply', chosen.length) }}</v-btn>
        </template>
        <template v-else>
          <v-btn v-if="!undone && result.canRollback" variant="tonal" :loading="applying" data-test="rename-undo" @click="undo">{{ $t('rename.undo') }}</v-btn>
          <v-btn variant="flat" color="primary" @click="open = false">{{ $t('common.close') }}</v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.lead {
  margin: 0 0 16px;
}
.tpl {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}
.tpl > .v-input {
  flex: 1 1 14rem;
  min-width: 0;
}
.rows {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  gap: 2px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 4px 8px;
  border-radius: 6px;
}
.row:hover {
  background: rgb(var(--v-theme-surface-light));
}
.row--sub {
  margin-left: 1.75rem;
}
.row--off {
  opacity: 0.8;
}
.row__gap {
  width: 2.5rem;
  flex: none;
}
.row__names {
  flex: 1 1 12rem;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 0.85rem;
}
.row__from {
  opacity: 0.75;
  word-break: break-all;
}
.row__to {
  font-weight: 600;
  word-break: break-all;
}
.row__arrow {
  flex: none;
  opacity: 0.6;
}
.note {
  margin: 16px 0 0;
  font-size: 0.82rem;
}
.summary {
  margin-left: 12px;
  font-size: 0.85rem;
}
</style>
