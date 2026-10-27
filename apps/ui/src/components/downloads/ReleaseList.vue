<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiArrowLeft, mdiClose, mdiMagnify } from '@mdi/js'
import type { Release, ReleaseKind, ReleaseSource, Resolution } from '@theama/contracts'
import { useDownloadsStore } from '@/stores/downloads'
import { formatBytes } from '@/utils/format'

type Query = { kind: ReleaseKind; title: string; year?: number | undefined; season?: number | undefined; episode?: number | undefined }

const props = defineProps<{ query: Query }>()
defineEmits<{ back: [] }>()

const { t, locale } = useI18n()
const downloads = useDownloadsStore()

// The search that is on screen. The fields below are edited freely and only replace it on Search.
const active = ref<Query>(props.query)
const title = ref('')
const year = ref('')
const season = ref('')
const episode = ref('')

const loading = ref(false)
const error = ref<{ code: string; message: string } | null>(null)
const source = ref<ReleaseSource | null>(null)
const items = ref<Release[]>([])
const received = ref(0)
const resolution = ref<Resolution | null>(null)
const minSeeders = ref('')
/** Asks the server to keep results that do not look like the title. Off for every new title. */
const unmatched = ref(false)
const adding = ref<string | null>(null)
const sent = ref(new Set<string>())
const snackbar = ref('')
let generation = 0
let controller: AbortController | undefined
onBeforeUnmount(() => { generation++; controller?.abort() })

const num = (v: string): number | undefined => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function fill(q: Query): void {
  title.value = q.title
  year.value = q.year === undefined ? '' : String(q.year)
  season.value = q.season === undefined ? '' : String(q.season)
  episode.value = q.episode === undefined ? '' : String(q.episode)
}

const resolutions = computed(() => (['2160p', '1080p', '720p', '480p'] as const).filter((r) => items.value.some((i) => i.resolution === r)))
const shown = computed(() => {
  const least = num(minSeeders.value) ?? 0
  return items.value.filter((i) => (!resolution.value || i.resolution === resolution.value) && i.seeders >= least)
})
const filtered = computed(() => items.value.length > 0 && shown.value.length === 0)

async function run(): Promise<void> {
  const mine = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  items.value = []
  resolution.value = null
  const res = await downloads.findReleases({ ...active.value, unmatched: unmatched.value }, controller.signal)
  if (mine !== generation) return
  loading.value = false
  if (res.ok) {
    items.value = res.value.items
    source.value = res.value.source
    received.value = res.value.received
  } else {
    error.value = { code: res.code, message: res.message }
  }
}

// A new query (another title picked) starts a new search; the list lives only as long as it is on screen.
watch(
  () => props.query,
  (q) => {
    active.value = q
    fill(q)
    unmatched.value = false
    sent.value = new Set()
    void run()
  },
  { immediate: true },
)

function showUnmatched(show: boolean): void {
  unmatched.value = show
  void run()
}

// Searches again with the edited title and numbers; the kind of release stays the one that was opened.
function apply(): void {
  const text = title.value.trim()
  if (!text) return
  const kind = props.query.kind
  active.value = kind === 'movie'
    ? { kind, title: text, year: num(year.value) }
    : { kind, title: text, season: num(season.value), episode: num(season.value) === undefined ? undefined : num(episode.value) }
  sent.value = new Set()
  void run()
}

async function add(r: Release): Promise<void> {
  if (adding.value) return
  adding.value = r.id
  const res = await downloads.download(r.id, props.query.kind)
  adding.value = null
  if (res.ok) {
    sent.value = new Set([...sent.value, r.id])
    snackbar.value = t('downloads.releases.sent')
  } else if (res.code === 'release_expired') {
    error.value = { code: res.code, message: t('downloads.releases.expired') }
  } else {
    error.value = { code: res.code, message: res.message }
  }
}

function facts(r: Release): string[] {
  const out: string[] = []
  if (r.resolution) out.push(r.resolution)
  if (r.quality) out.push(r.quality)
  if (r.codec) out.push(r.codec)
  out.push(r.size > 0 ? formatBytes(r.size, locale.value) : t('downloads.releases.unknownSize'))
  if (r.pack) out.push(t('downloads.releases.pack'))
  return out
}

const heading = computed(() => {
  const q = active.value
  const bits = [q.title]
  if (q.kind === 'movie' && q.year) bits.push(`(${q.year})`)
  if (q.kind === 'series' && q.season !== undefined) bits.push(`S${String(q.season).padStart(2, '0')}${q.episode !== undefined ? `E${String(q.episode).padStart(2, '0')}` : ''}`)
  return bits.join(' ')
})
</script>

<template>
  <section class="rel" :aria-label="heading">
    <form class="rel__bar" role="search" @submit.prevent="apply">
      <v-btn :icon="mdiArrowLeft" variant="text" size="small" :aria-label="$t('downloads.releases.back')" data-test="releases-back" @click="$emit('back')" />
      <v-text-field
        v-model="title"
        :placeholder="$t('downloads.releases.title')"
        :aria-label="$t('downloads.releases.title')"
        density="compact"
        variant="solo-filled"
        flat
        bg-color="surface-bright"
        hide-details
        clearable
        :prepend-inner-icon="mdiMagnify"
        :clear-icon="mdiClose"
        :clear-label="$t('downloads.find.clear')"
        class="rel__text th-search-control"
        data-test="release-title"
      />
      <v-text-field v-if="query.kind === 'movie'" v-model="year" :placeholder="$t('downloads.find.year')" :aria-label="$t('downloads.find.year')" inputmode="numeric" density="compact" variant="solo-filled" flat bg-color="surface-bright" hide-details class="rel__small th-search-control" data-test="release-year" />
      <template v-else>
        <v-text-field v-model="season" :placeholder="$t('downloads.find.season')" :aria-label="$t('downloads.find.season')" inputmode="numeric" density="compact" variant="solo-filled" flat bg-color="surface-bright" hide-details class="rel__small th-search-control" data-test="release-season" />
        <v-text-field v-model="episode" :placeholder="$t('downloads.find.episode')" :aria-label="$t('downloads.find.episode')" inputmode="numeric" density="compact" variant="solo-filled" flat bg-color="surface-bright" :disabled="num(season) === undefined" hide-details class="rel__small th-search-control" data-test="release-episode" />
      </template>
      <v-btn type="submit" color="primary" :loading="loading" :disabled="!title.trim()" data-test="release-search">{{ $t('downloads.releases.search') }}</v-btn>
    </form>

    <div class="rel__filters">
      <v-chip-group v-if="resolutions.length > 1" v-model="resolution" column class="rel__chips" :aria-label="$t('detail.facts.resolution')">
        <v-chip v-for="r in resolutions" :key="r" :value="r" filter variant="tonal" size="small">{{ r }}</v-chip>
      </v-chip-group>
      <v-btn v-if="unmatched" variant="text" size="small" data-test="release-hide-unmatched" @click="showUnmatched(false)">{{ $t('downloads.releases.hideUnmatched') }}</v-btn>
      <v-text-field
        v-model="minSeeders"
        :label="$t('downloads.releases.minSeeders')"
        inputmode="numeric"
        density="compact"
        variant="outlined"
        hide-details
        class="rel__seeders-filter"
        data-test="release-min-seeders"
      />
    </div>

    <v-alert v-if="error" type="warning" variant="tonal" density="compact" class="mb-3" data-test="release-error">
      {{ error.message }}
      <template v-if="error.code === 'not_configured'">
        <router-link to="/settings/downloads">{{ $t('downloads.find.openSettings') }}</router-link>
      </template>
      <template #append><v-btn variant="text" size="small" @click="run">{{ $t('common.retry') }}</v-btn></template>
    </v-alert>

    <p v-if="filtered" class="th-muted" data-test="release-filtered">{{ $t('downloads.releases.filteredOut') }}</p>
    <div v-if="!loading && !error && items.length === 0">
      <p class="th-muted" data-test="release-none">{{ $t(received === 0 ? 'downloads.releases.nothingReceived' : 'downloads.releases.noneMatched', { count: received, source: source ? $t(`downloads.releases.name.${source}`) : '' }) }}</p>
      <v-btn v-if="received > 0 && !unmatched" variant="tonal" size="small" data-test="release-show-unmatched" @click="showUnmatched(true)">{{ $t('downloads.releases.showUnmatched') }}</v-btn>
    </div>

    <ul v-if="shown.length > 0" class="releases" role="list" data-test="release-list">
      <li v-for="r in shown" :key="r.id" class="release">
        <div class="release__main">
          <span class="release__title">{{ r.title }}</span>
          <span class="release__facts th-muted">
            {{ facts(r).join(' · ') }}<template v-if="r.indexer"> · {{ r.indexer }}</template>
          </span>
        </div>
        <span class="release__seeders th-muted">{{ $t('downloads.releases.seeders', r.seeders) }}</span>
        <v-btn
          :color="sent.has(r.id) ? 'success' : 'primary'"
          :variant="sent.has(r.id) ? 'tonal' : 'flat'"
          size="small"
          :loading="adding === r.id"
          :disabled="adding !== null || sent.has(r.id)"
          data-test="release-download"
          @click="add(r)"
        >{{ sent.has(r.id) ? $t('downloads.releases.sent') : $t('downloads.releases.download') }}</v-btn>
      </li>
    </ul>

    <v-snackbar :model-value="snackbar !== ''" :timeout="2400" color="surface-bright" @update:model-value="snackbar = ''">{{ snackbar }}</v-snackbar>
  </section>
</template>

<style scoped>
/* Same bordered toolbar as the title search it replaces: fields share one border, Search is the only filled control. */
.rel__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 4px;
  border: var(--th-border);
  border-radius: calc(var(--th-radius) + 4px);
  background: rgba(var(--v-theme-surface), 0.84);
  transition: border-color var(--th-motion);
}
.rel__bar:focus-within {
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.rel__text {
  flex: 1 1 10rem;
  min-width: 0;
}
.rel__small {
  flex: 0 1 6.5rem;
  min-width: 5rem;
}
.rel__bar :deep(.th-search-control .v-field) {
  background: transparent !important;
  box-shadow: none;
  border-radius: var(--th-radius);
}
.rel__bar :deep(.th-search-control .v-field:hover),
.rel__bar :deep(.th-search-control:focus-within .v-field) {
  background: rgb(var(--v-theme-surface-light)) !important;
  box-shadow: none;
}
.rel__bar > .v-btn[type='submit'] {
  flex: 0 0 auto;
  min-height: var(--th-control-h);
  border-radius: var(--th-radius);
}
.rel__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 8px 0 4px;
}
.rel__seeders-filter {
  flex: 0 1 9rem;
  margin-left: auto;
}
.releases {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.release {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-theme-hairline), 0.72);
}
.release__main {
  display: grid;
  min-width: 0;
}
.release__title {
  overflow-wrap: anywhere;
  font-weight: 500;
}
.release__facts,
.release__seeders {
  font-size: 0.82rem;
}
@media (max-width: 40rem) {
  .release {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .release__seeders {
    grid-column: 1;
  }
}
</style>
