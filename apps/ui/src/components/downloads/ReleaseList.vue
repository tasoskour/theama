<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiArrowLeft, mdiClose, mdiMagnify } from '@mdi/js'
import type { DownloadTool, Release, ReleaseKind, Resolution } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useSettingsStore } from '@/stores/settings'
import { useDownloadsStore } from '@/stores/downloads'
import { useDownloadToolsStore } from '@/stores/downloadTools'
import { formatBytes } from '@/utils/format'
import { toolLogos } from './toolLogos'
import { groupReleases, type ReleaseGroup } from './releaseGroups'
import { episodesOf, filterReleases, seasonsOf, sortReleases, type ReleaseSort } from './releaseSort'

type Query = { kind: ReleaseKind; title: string; year?: number | undefined; season?: number | undefined; episode?: number | undefined; collectionName?: string | undefined }

const props = defineProps<{ query: Query }>()
defineEmits<{ back: [] }>()

const { t, locale } = useI18n()
const downloads = useDownloadsStore()
const settings = useSettingsStore()
const tools = useDownloadToolsStore()

// The search that is on screen. The fields below are edited freely and only replace it on Search.
const active = ref<Query>(props.query)
const title = ref('')
const year = ref('')
const season = ref('')
const episode = ref('')

const loading = ref(false)
const error = ref<{ code: string; message: string; tool: DownloadTool } | null>(null)
const items = ref<Release[]>([])
const received = ref(0)
const resolution = ref<Resolution | null>(null)
const minSeeders = ref('')
const sort = ref<ReleaseSort>('quality')
const seasonFilter = ref<number | null>(null)
const episodeFilter = ref<number | null>(null)
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
const seasons = computed(() => seasonsOf(items.value))
const episodes = computed(() => episodesOf(items.value, seasonFilter.value))
const seasonItems = computed(() => [{ title: t('downloads.releases.filters.allSeasons'), value: null }, ...seasons.value.map((n) => ({ title: t('downloads.releases.filters.seasonOption', { n }), value: n }))])
const episodeItems = computed(() => [{ title: t('downloads.releases.filters.allEpisodes'), value: null }, ...episodes.value.map((n) => ({ title: t('downloads.releases.filters.episodeOption', { n }), value: n }))])
// Sorting and filtering only reorder what was already fetched; nothing here asks the server again.
const shown = computed(() => sortReleases(
  filterReleases(items.value, { resolution: resolution.value, minSeeders: num(minSeeders.value) ?? 0, season: seasonFilter.value, episode: episodeFilter.value }),
  sort.value,
))
const filtered = computed(() => items.value.length > 0 && shown.value.length === 0)
const emptyMessageKey = computed(() => received.value === 0 ? 'downloads.releases.nothingReceivedProwlarr' : 'downloads.releases.noneMatchedProwlarr')
const groups = computed(() => groupReleases(shown.value, active.value.kind))
function groupLabel(group: ReleaseGroup): string {
  switch (group.type) {
    case 'collection': return t('downloads.releases.groups.collections')
    case 'movie': return t('downloads.releases.groups.movies')
    case 'complete': return t('downloads.releases.groups.completeSeries')
    case 'season': return t('downloads.releases.groups.seasonPacks', { season: group.season })
    case 'episode': return t('downloads.releases.groups.episode', { season: group.season, episode: group.episode })
    case 'other': return t('downloads.releases.groups.other')
  }
}

async function run(): Promise<void> {
  const mine = ++generation
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  items.value = []
  const res = await downloads.findReleases({ ...active.value, unmatched: unmatched.value }, controller.signal)
  if (mine !== generation) return
  loading.value = false
  if (res.ok) {
    items.value = res.value.items
    received.value = res.value.received
  } else {
    await failed({ code: res.code, message: res.message, tool: failedTool(res.message, 'prowlarr') }, true)
  }
}

/**
 * A closed app is offered to be opened instead of shown as an error. Once it is open a search runs again;
 * a download is left for the person to click once more. Declining shows the error with the same offer.
 */
async function failed(problem: { code: string; message: string; tool: DownloadTool }, search: boolean): Promise<void> {
  if (problem.code !== 'unreachable' || !tools.available) {
    error.value = problem
    return
  }
  const mine = generation
  const opened = await tools.ask(problem.tool)
  if (mine !== generation) return
  if (!opened) {
    error.value = { ...problem, message: t(`downloads.tools.notRunning.${problem.tool}`) }
    return
  }
  await downloads.load()
  if (mine === generation && search) void run()
}

// A new query (another title picked) starts a new search; the list lives only as long as it is on screen.
watch(
  () => props.query,
  (q) => {
    active.value = q
    fill(q)
    resolution.value = null
    seasonFilter.value = null
    episodeFilter.value = null
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
    ? { kind, title: text, year: num(year.value), ...(text === props.query.title ? { collectionName: props.query.collectionName } : {}) }
    : { kind, title: text, season: num(season.value), episode: num(season.value) === undefined ? undefined : num(episode.value) }
  resolution.value = null
  seasonFilter.value = null
  episodeFilter.value = null
  sent.value = new Set()
  void run()
}

async function add(r: Release): Promise<void> {
  if (adding.value) return
  let savePath: string | undefined
  const bridge = getBridge()
  if (bridge && settings.settings.downloadAskFolder) {
    const picked = await bridge.pickFolder(t('downloads.folders.askTitle'))
    if (!picked) return
    savePath = picked
  }
  adding.value = r.id
  const res = await downloads.download(r.id, props.query.kind, savePath)
  adding.value = null
  if (res.ok) {
    sent.value = new Set([...sent.value, r.id])
    snackbar.value = t('downloads.releases.sent')
  } else if (res.code === 'release_expired') {
    error.value = { code: res.code, message: t('downloads.releases.expired'), tool: 'qbittorrent' }
  } else {
    await failed({ code: res.code, message: res.message, tool: failedTool(res.message, 'qbittorrent') }, false)
  }
}

/** The server names the app it could not reach; otherwise it is the one this step talks to. */
function failedTool(message: string, fallback: DownloadTool): DownloadTool {
  if (/prowlarr/i.test(message)) return 'prowlarr'
  return /qbittorrent/i.test(message) ? 'qbittorrent' : fallback
}

/** Starts the app that did not answer, then looks again. A download is left for the person to click once more. */
async function openFailed(): Promise<void> {
  const failed = error.value
  if (!failed || !(await tools.open(failed.tool))) return
  await downloads.load()
  if (error.value === failed && items.value.length === 0) void run()
  else error.value = null
}

function facts(r: Release): string[] {
  const out: string[] = []
  if (r.resolution) out.push(r.resolution)
  if (r.quality) out.push(r.quality)
  if (r.codec) out.push(r.codec)
  out.push(r.size > 0 ? formatBytes(r.size, locale.value) : t('downloads.releases.unknownSize'))
  if (r.collectionPack) out.push(t('downloads.releases.collectionUnverified'))
  else if (r.pack) out.push(t(r.season === null ? 'downloads.releases.completeSeriesPack' : 'downloads.releases.pack'))
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
      <v-select
        v-model="sort"
        :items="[{ title: $t('downloads.releases.sort.quality'), value: 'quality' }, { title: $t('downloads.releases.sort.seeders'), value: 'seeders' }]"
        :label="$t('downloads.releases.sort.label')"
        density="compact"
        variant="outlined"
        hide-details
        class="rel__sort"
        data-test="release-sort"
      />
      <template v-if="active.kind === 'series' && seasons.length > 0">
        <v-select
          v-model="seasonFilter"
          :items="seasonItems"
          :label="$t('downloads.releases.filters.season')"
          density="compact"
          variant="outlined"
          hide-details
          class="rel__sort"
          data-test="release-season-filter"
          @update:model-value="episodeFilter = null"
        />
        <v-select
          v-model="episodeFilter"
          :items="episodeItems"
          :label="$t('downloads.releases.filters.episode')"
          :disabled="seasonFilter === null"
          density="compact"
          variant="outlined"
          hide-details
          class="rel__sort"
          data-test="release-episode-filter"
        />
      </template>
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
      <template #append>
        <v-btn
          v-if="tools.available && error.code === 'unreachable'"
          variant="tonal"
          size="small"
          class="mr-1"
          :loading="tools.opening[error.tool] === true"
          :disabled="tools.opening[error.tool] === true"
          :aria-label="$t(`downloads.tools.openLabel.${error.tool}`)"
          data-test="release-open-tool"
          @click="openFailed"
        >
          <img :src="toolLogos[error.tool]" alt="" width="18" height="18" class="mr-2">
          {{ $t(`downloads.tools.openLabel.${error.tool}`) }}
        </v-btn>
        <v-btn variant="text" size="small" @click="run">{{ $t('common.retry') }}</v-btn>
      </template>
    </v-alert>

    <p v-if="filtered" class="th-muted" data-test="release-filtered">{{ $t('downloads.releases.filteredOut') }}</p>
    <div v-if="!loading && !error && items.length === 0">
      <p class="th-muted" data-test="release-none">{{ $t(emptyMessageKey, { count: received }) }}</p>
      <v-btn v-if="received > 0 && !unmatched" variant="tonal" size="small" data-test="release-show-unmatched" @click="showUnmatched(true)">{{ $t('downloads.releases.showUnmatched') }}</v-btn>
    </div>

    <div v-if="groups.length > 0" data-test="release-list">
      <section v-for="group in groups" :key="group.key" class="rel__group" :aria-label="groupLabel(group)" :data-test="`release-group-${group.key}`">
        <h3 class="rel__group-title">{{ groupLabel(group) }}</h3>
        <ul class="releases" role="list">
          <li v-for="r in group.items" :key="r.id" class="release">
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
      </section>
    </div>

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
.rel__sort {
  flex: 0 1 12rem;
}
.rel__group {
  margin-top: 24px;
}
.rel__group:first-child {
  margin-top: 16px;
}
.rel__group-title {
  margin: 0 0 6px;
  padding: 10px 14px;
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  border-inline-start: 3px solid rgba(var(--v-theme-primary), 0.7);
  border-radius: var(--th-radius);
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
  font-size: 0.8rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  line-height: 1.5;
  overflow-wrap: anywhere;
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
