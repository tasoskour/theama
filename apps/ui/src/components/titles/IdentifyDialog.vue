<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TitleDetail, type MatchCandidate, type MatchKind } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import { useConnectionStore } from '@/stores/connection'
import { useMetadataStore } from '@/stores/metadata'
import PosterArt from './PosterArt.vue'
import SearchField from '@/components/common/SearchField.vue'

const props = defineProps<{ titleKey: string; kind: MatchKind; initialQuery: string; initialYear: number | null }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ identified: [detail: TitleDetail] }>()

const { t } = useI18n()
const connection = useConnectionStore()
const metadata = useMetadataStore()

const query = ref('')
const results = ref<MatchCandidate[] | null>(null)
const searching = ref(false)
const choosing = ref<string | null>(null)
const error = ref<{ code: string; message: string } | null>(null)
let searchGeneration = 0
let controller: AbortController | undefined
let debounce: ReturnType<typeof setTimeout> | undefined
let skipNextDebounce = false

async function search(): Promise<void> {
  const q = query.value.trim()
  clearTimeout(debounce)
  controller?.abort()
  const mine = ++searchGeneration
  if (!q) {
    results.value = null
    error.value = null
    searching.value = false
    return
  }
  controller = new AbortController()
  searching.value = true
  error.value = null
  const res = await metadata.search(props.kind, q, undefined, controller.signal)
  if (mine !== searchGeneration) return
  searching.value = false
  if (res.ok) results.value = res.items
  else {
    error.value = { code: res.code, message: res.message }
  }
}

async function choose(c: MatchCandidate): Promise<void> {
  if (!connection.client || choosing.value) return
  choosing.value = c.externalId
  error.value = null
  try {
    const detail = await connection.client.post('/library/title/identify', { key: props.titleKey, kind: props.kind, externalId: c.externalId }, TitleDetail)
    open.value = false
    emit('identified', detail)
  } catch (err) {
    error.value =
      err instanceof ApiRequestError ? { code: err.code, message: err.message } : { code: 'unreachable', message: err instanceof Error ? err.message : String(err) }
  } finally {
    choosing.value = null
  }
}

// Each time the dialog opens it starts from the name found in the files, searched straight away.
watch(open, (isOpen) => {
  clearTimeout(debounce)
  searchGeneration++
  controller?.abort()
  if (!isOpen) return
  skipNextDebounce = query.value !== props.initialQuery
  query.value = props.initialQuery
  results.value = null
  error.value = null
  void search()
})

watch(query, () => {
  if (!open.value) return
  if (skipNextDebounce) {
    skipNextDebounce = false
    return
  }
  clearTimeout(debounce)
  searchGeneration++
  controller?.abort()
  searching.value = false
  const q = query.value.trim()
  if (!q) {
    results.value = null
    error.value = null
    searching.value = false
    return
  }
  debounce = setTimeout(() => void search(), 275)
})

onScopeDispose(() => { clearTimeout(debounce); searchGeneration++; controller?.abort() })

function problem(code: string, fallback: string): string {
  return ['no_key', 'invalid_key', 'provider_unavailable'].includes(code) ? t(`match.errors.${code}`) : fallback
}
</script>

<template>
  <v-dialog v-model="open" max-width="51rem" scrollable aria-labelledby="identify-title">
    <v-card class="identify-card">
      <v-card-title id="identify-title" class="th-display">{{ $t('match.dialog.title') }}</v-card-title>
      <v-card-subtitle class="subtitle">{{ $t('match.dialog.subtitle', { name: initialQuery }) }}</v-card-subtitle>
      <v-card-text>
        <form class="search" role="search" @submit.prevent="search">
          <SearchField
            v-model="query"
            :label="$t(kind === 'series' ? 'match.dialog.searchSeries' : 'match.dialog.searchMovie')"
            autofocus
            :loading="searching"
          />
        </form>

        <v-alert v-if="error" type="warning" variant="tonal" density="compact" class="mt-4">
          {{ problem(error.code, error.message) }}
          <template v-if="error.code === 'no_key' || error.code === 'invalid_key'">
            <router-link to="/settings/metadata" @click="open = false">{{ $t('match.openSettings') }}</router-link>
          </template>
        </v-alert>

        <p v-if="results && results.length === 0 && !searching" class="th-muted result-state">{{ $t('match.dialog.none') }}</p>

        <ul v-if="results?.length" class="candidates" role="list" :aria-label="$t('match.dialog.results')">
          <li v-for="c in results" :key="c.externalId" class="cand" data-test="identify-candidate">
            <div class="cand__art">
              <PosterArt :seed="`${c.provider}:${c.externalId}`" :title="c.title" :year="c.year" :kind="c.kind" :image-url="connection.assetUrl(c.posterUrl)" />
            </div>
            <div class="cand__info">
              <div class="cand__title">
                {{ c.title }}<span v-if="c.year" class="th-muted"> ({{ c.year }})</span>
              </div>
              <div v-if="c.originalTitle && c.originalTitle !== c.title" class="th-muted cand__orig">{{ c.originalTitle }}</div>
              <p v-if="c.overview" class="cand__overview">{{ c.overview }}</p>
              <p v-else class="th-muted cand__overview">{{ $t('match.dialog.noOverview') }}</p>
            </div>
            <v-btn
              variant="tonal"
              color="primary"
              :loading="choosing === c.externalId"
              :disabled="choosing !== null"
              :aria-label="$t('match.dialog.choose', { name: c.title, year: c.year ?? '' })"
              @click="choose(c)"
            >{{ $t('match.dialog.pick') }}</v-btn>
          </li>
        </ul>
      </v-card-text>
      <v-card-actions>
        <p class="th-muted note">{{ $t('match.dialog.lockNote') }}</p>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('common.cancel') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.identify-card {
  overflow: hidden;
}
.subtitle {
  white-space: normal;
}
.search {
  position: sticky;
  top: 0;
  z-index: 2;
  padding-bottom: 4px;
  background: rgb(var(--v-theme-surface));
}
.candidates {
  container: cands / inline-size;
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  gap: 12px;
}
.cand {
  display: grid;
  grid-template-columns: 4.5rem minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(var(--v-theme-hairline), 0.76);
  border-radius: calc(var(--th-radius) + 2px);
  background: rgba(var(--v-theme-surface-light), 0.34);
  transition: border-color var(--th-motion), background-color var(--th-motion);
}
.cand:hover,
.cand:focus-within {
  border-color: rgba(var(--v-theme-primary), 0.58);
  background: rgba(var(--v-theme-primary), 0.06);
}
.cand__art {
  width: 4.5rem;
  min-width: 0;
  max-width: 4.5rem;
  overflow: hidden;
  border-radius: var(--th-radius);
}
.cand__info {
  min-width: 0;
}
.cand__title {
  font-weight: 600;
  line-height: 1.3;
}
.cand__orig {
  font-size: 0.85rem;
}
.cand__overview {
  margin: 6px 0 0;
  font-size: 0.88rem;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.note {
  margin: 0 12px;
  font-size: 0.8rem;
}
.result-state {
  padding: 24px 4px 12px;
}
@media (max-width: 600px) {
  .identify-card {
    border-radius: 0 !important;
  }
  /* Keep the explanation visible on small screens: it takes its own line above the buttons. */
  .note {
    flex: 1 1 100%;
    margin: 0 4px 4px;
  }
}
/* Measured on the list itself (so the text size counts), not on the window. */
@container cands (max-width: 34rem) {
  .cand {
    grid-template-columns: 4rem minmax(0, 1fr);
    align-items: start;
  }
  .cand__art {
    width: 4rem;
    max-width: 4rem;
    grid-row: 1;
  }
  .cand > .v-btn {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
