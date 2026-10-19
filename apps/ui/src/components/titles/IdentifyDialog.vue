<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiMagnify } from '@mdi/js'
import { TitleDetail, type MatchCandidate, type MatchKind } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import { useConnectionStore } from '@/stores/connection'
import { useMetadataStore } from '@/stores/metadata'
import PosterArt from './PosterArt.vue'

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

async function search(): Promise<void> {
  const q = query.value.trim()
  if (!q || searching.value) return
  searching.value = true
  error.value = null
  const res = await metadata.search(props.kind, q)
  searching.value = false
  if (res.ok) results.value = res.items
  else {
    results.value = null
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
  if (!isOpen) return
  query.value = props.initialQuery
  results.value = null
  error.value = null
  void search()
})

function problem(code: string, fallback: string): string {
  return ['no_key', 'invalid_key', 'provider_unavailable'].includes(code) ? t(`match.errors.${code}`) : fallback
}
</script>

<template>
  <v-dialog v-model="open" max-width="720" scrollable aria-labelledby="identify-title">
    <v-card class="pa-2">
      <v-card-title id="identify-title" class="th-display">{{ $t('match.dialog.title') }}</v-card-title>
      <v-card-subtitle class="subtitle">{{ $t('match.dialog.subtitle', { name: initialQuery }) }}</v-card-subtitle>
      <v-card-text>
        <form class="search" role="search" @submit.prevent="search">
          <v-text-field
            v-model="query"
            :label="$t(kind === 'series' ? 'match.dialog.searchSeries' : 'match.dialog.searchMovie')"
            :prepend-inner-icon="mdiMagnify"
            autofocus
            hide-details
            spellcheck="false"
          />
          <v-btn type="submit" color="primary" :loading="searching" :disabled="!query.trim()">{{ $t('common.search') }}</v-btn>
        </form>

        <v-alert v-if="error" type="warning" variant="tonal" density="compact" class="mt-4">
          {{ problem(error.code, error.message) }}
          <template v-if="error.code === 'no_key' || error.code === 'invalid_key'">
            <router-link to="/settings/metadata" @click="open = false">{{ $t('match.openSettings') }}</router-link>
          </template>
        </v-alert>

        <p v-if="results && results.length === 0" class="th-muted mt-4">{{ $t('match.dialog.none') }}</p>

        <ul v-if="results?.length" class="candidates" role="list" :aria-label="$t('match.dialog.results')">
          <li v-for="c in results" :key="c.externalId" class="cand">
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
.subtitle {
  white-space: normal;
}
.search {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.candidates {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: grid;
  gap: 12px;
}
.cand {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  padding: 12px;
  border: 1px solid rgb(var(--v-theme-hairline));
  border-radius: var(--th-radius);
}
.cand__title {
  font-weight: 600;
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
</style>
