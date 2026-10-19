<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { mdiArrowLeft, mdiCloudOffOutline, mdiDotsVertical, mdiPlay, mdiStar } from '@mdi/js'
import { TitleDetail, type EpisodeInfo, type MediaFile } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import FileFacts from '@/components/titles/FileFacts.vue'
import IdentifyDialog from '@/components/titles/IdentifyDialog.vue'
import PosterArt from '@/components/titles/PosterArt.vue'
import { useConnectionStore } from '@/stores/connection'
import { useMetadataStore } from '@/stores/metadata'
import { episodeCode, formatBytes, formatDuration, resolutionLabel } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const connection = useConnectionStore()
const metadataStore = useMetadataStore()
const { t, locale } = useI18n()

const detail = ref<TitleDetail | null>(null)
const missing = ref(false)
const error = ref<string | null>(null)
const season = ref<string>('')
const heading = ref<HTMLElement | null>(null)

const key = computed(() => String(route.query.key ?? ''))

async function load(): Promise<void> {
  if (!connection.client || !key.value) return
  try {
    detail.value = await connection.client.get('/library/title', TitleDetail, { key: key.value })
    missing.value = false
    error.value = null
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'not_found') {
      detail.value = null
      missing.value = true
    } else error.value = err instanceof Error ? err.message : String(err)
  }
}

watch([() => connection.phase, key], () => connection.phase === 'connected' && void load().then(() => nextTick(() => heading.value?.focus())), { immediate: true })
const off = connection.onEvent((e) => {
  if (e.type === 'library.changed' || e.type === 'scan.finished') void load()
})
onScopeDispose(off)

function back(): void {
  if (window.history.state?.back) router.back()
  else void router.push('/')
}

const summary = computed(() => detail.value?.summary ?? null)
const files = computed(() => detail.value?.files ?? [])
const isSeries = computed(() => summary.value?.kind === 'series')
const offline = computed(() => summary.value !== null && summary.value.availableCount === 0)

const meta = computed(() => detail.value?.metadata ?? null)
const match = computed(() => detail.value?.match ?? null)
const canIdentify = computed(() => summary.value !== null && summary.value.kind !== 'video')
const posterSrc = computed(() => connection.assetUrl(meta.value?.posterUrl ?? summary.value?.posterUrl))
const heroStyle = computed(() => {
  const backdrop = connection.assetUrl(meta.value?.backdropUrl)
  if (!backdrop) return {}
  const veil = 'linear-gradient(90deg, rgba(var(--v-theme-surface), 0.96), rgba(var(--v-theme-surface), 0.72))'
  return { backgroundImage: `${veil}, url("${backdrop}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
})
const ratingText = computed(() => {
  const r = meta.value?.rating
  if (!r) return ''
  return t('match.rating', { source: r.source.toUpperCase(), value: r.value.toFixed(1), votes: new Intl.NumberFormat(locale.value).format(r.votes) })
})

// --- identification ---------------------------------------------------
const identifyOpen = ref(false)
const working = ref(false)
const actionError = ref<string | null>(null)

async function act(path: string): Promise<void> {
  if (!connection.client || working.value) return
  working.value = true
  actionError.value = null
  try {
    detail.value = await connection.client.post(path, { key: key.value }, TitleDetail)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  } finally {
    working.value = false
  }
}
const refreshDetails = () => act('/library/title/refresh')
const clearMatch = () => act('/library/title/clear-match')
const unlockMatch = () => act('/library/title/unlock')
function onIdentified(d: TitleDetail): void {
  detail.value = d
  actionError.value = null
}

/** Provider details by episode, so each file row can show its real name and description. */
const episodeInfo = computed(() => new Map<string, EpisodeInfo>((detail.value?.episodes ?? []).map((e) => [`${e.season}:${e.episode}`, e])))
function infoFor(f: MediaFile): EpisodeInfo | null {
  return f.season !== null && f.episode !== null ? (episodeInfo.value.get(`${f.season}:${f.episode}`) ?? null) : null
}
function episodeName(f: MediaFile): string {
  return infoFor(f)?.name || f.episodeTitle || f.fileName
}

/** Season tabs: numbered seasons ascending (0 = Specials), then episodes with no season. */
interface SeasonGroup { id: string; label: string; episodes: MediaFile[] }
const seasons = computed<SeasonGroup[]>(() => {
  if (!isSeries.value) return []
  const bySeason = new Map<number | null, MediaFile[]>()
  for (const f of files.value) bySeason.set(f.season, [...(bySeason.get(f.season) ?? []), f])
  const numbered = [...bySeason.keys()].filter((s): s is number => s !== null).sort((a, b) => a - b)
  const groups: SeasonGroup[] = numbered.map((s) => ({
    id: String(s),
    label: s === 0 ? t('detail.specials') : t('detail.season', { n: s }),
    episodes: bySeason.get(s)!,
  }))
  if (bySeason.has(null)) groups.push({ id: 'none', label: t('detail.unnumbered'), episodes: bySeason.get(null)! })
  return groups
})
watch(seasons, (groups) => {
  if (!groups.some((g) => g.id === season.value)) season.value = groups[0]?.id ?? ''
}, { immediate: true })
const shown = computed(() => seasons.value.find((g) => g.id === season.value)?.episodes ?? [])

const kindLabel = computed(() => (summary.value ? t(`detail.kind.${summary.value.kind}`) : ''))
const expanded = ref<number | null>(null)

const metaChips = computed(() => {
  const s = summary.value
  if (!s) return []
  const chips: string[] = []
  if (s.year) chips.push(String(s.year))
  if (s.kind === 'series') {
    if (s.seasonCount > 0) chips.push(t('titles.seasons', s.seasonCount))
    chips.push(t('titles.episodes', s.episodeCount > 0 ? s.episodeCount : s.fileCount))
  } else {
    const best = files.value.find((f) => f.durationMs !== null)
    if (best?.durationMs) chips.push(formatDuration(best.durationMs, locale.value))
    else if (meta.value?.runtimeMinutes) chips.push(formatDuration(meta.value.runtimeMinutes * 60_000, locale.value))
    const res = files.value.map((f) => resolutionLabel(f.width, f.height)).find(Boolean)
    if (res) chips.push(res)
    if (s.fileCount > 1) chips.push(t('detail.versions', s.fileCount))
  }
  chips.push(formatBytes(s.size, locale.value))
  return chips
})
</script>

<template>
  <div class="th-page detail">
    <v-btn variant="text" :prepend-icon="mdiArrowLeft" class="back" @click="back">{{ $t('detail.back') }}</v-btn>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
    <section v-if="missing" class="gone">
      <h1 class="th-display">{{ $t('detail.gone') }}</h1>
      <p class="th-muted">{{ $t('detail.goneHint') }}</p>
    </section>

    <template v-if="summary">
      <section class="hero" :style="heroStyle">
        <div class="hero__poster"><PosterArt :seed="summary.key" :title="summary.title" :year="summary.kind === 'movie' ? summary.year : null" :kind="summary.kind" :image-url="posterSrc" /></div>
        <div class="hero__info">
          <p class="th-eyebrow">{{ kindLabel }}</p>
          <h1 ref="heading" tabindex="-1" class="th-display hero__title">{{ summary.title }}</h1>
          <p v-if="meta?.originalTitle && meta.originalTitle !== summary.title" class="th-muted original">{{ meta.originalTitle }}</p>
          <p v-if="meta?.tagline" class="tagline">{{ meta.tagline }}</p>
          <ul class="chips" :aria-label="$t('detail.summary')">
            <li v-for="c in metaChips" :key="c"><v-chip size="small" label variant="tonal">{{ c }}</v-chip></li>
            <li v-if="ratingText">
              <v-chip size="small" label variant="tonal" color="primary" :prepend-icon="mdiStar" data-test="rating">{{ ratingText }}</v-chip>
            </li>
            <li v-for="g in meta?.genres ?? []" :key="g"><v-chip size="small" label variant="outlined">{{ g }}</v-chip></li>
          </ul>
          <p v-if="meta?.overview" class="overview" data-test="overview">{{ meta.overview }}</p>

          <v-alert v-if="offline" type="warning" variant="tonal" density="compact" :icon="mdiCloudOffOutline" class="mt-4">{{ $t('files.offlineHint') }}</v-alert>

          <div class="cta">
            <!-- Honest placeholder: playback with external players is the next release; nothing pretends to play. -->
            <v-btn color="primary" size="large" :prepend-icon="mdiPlay" disabled aria-describedby="play-note">{{ $t('detail.play') }}</v-btn>
            <p id="play-note" class="th-muted text-caption">{{ $t('detail.playSoon') }}</p>
          </div>
        </div>
      </section>

      <!-- Identification: what Theama thinks this is, and the ways to put it right. -->
      <section v-if="canIdentify" class="match" :aria-label="$t('match.section')" data-test="match">
        <v-alert v-if="match?.state === 'ambiguous'" type="info" variant="tonal" density="comfortable" :title="$t('match.ambiguous')">
          {{ $t('match.ambiguousHint') }}
          <template #append><v-btn variant="flat" color="primary" @click="identifyOpen = true">{{ $t('match.choose') }}</v-btn></template>
        </v-alert>
        <v-alert v-else-if="match?.state === 'unmatched'" type="info" variant="tonal" density="comfortable" :title="$t('match.unmatched')">
          {{ $t(match.decidedBy === 'user' ? 'match.clearedHint' : 'match.unmatchedHint') }}
          <template #append><v-btn variant="flat" color="primary" @click="identifyOpen = true">{{ $t('match.search') }}</v-btn></template>
        </v-alert>
        <div v-else-if="match?.state === 'matched'" class="match__line">
          <span class="th-muted">{{ $t(match.decidedBy === 'user' ? 'match.byYou' : 'match.automatic', { source: 'TMDB' }) }}</span>
          <v-chip v-if="match.locked" size="x-small" label variant="outlined">{{ $t('match.locked') }}</v-chip>
        </div>
        <div v-else-if="!metadataStore.status?.configured" class="match__line th-muted">
          {{ $t('match.noKey') }} <router-link to="/settings/metadata">{{ $t('match.openSettings') }}</router-link>
        </div>
        <div v-else class="match__line th-muted">{{ $t('match.pending') }}</div>

        <v-menu v-if="match" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn v-bind="menuProps" variant="text" size="small" :prepend-icon="mdiDotsVertical" :loading="working" data-test="match-menu">{{ $t('match.manage') }}</v-btn>
          </template>
          <v-list density="compact">
            <v-list-item :title="$t(match.state === 'matched' ? 'match.change' : 'match.search')" @click="identifyOpen = true" />
            <v-list-item v-if="match.state === 'matched'" :title="$t('match.refresh')" @click="refreshDetails" />
            <v-list-item v-if="match.state === 'matched'" :title="$t('match.clear')" @click="clearMatch" />
            <v-list-item v-if="match.locked" :title="$t('match.unlock')" :subtitle="$t('match.unlockHint')" @click="unlockMatch" />
          </v-list>
        </v-menu>
        <v-alert v-if="actionError" type="error" variant="tonal" density="compact" class="mt-2">{{ actionError }}</v-alert>
      </section>

      <IdentifyDialog
        v-if="summary.kind !== 'video'"
        v-model="identifyOpen"
        :title-key="summary.key"
        :kind="summary.kind"
        :initial-query="meta?.title ?? summary.title"
        :initial-year="summary.year"
        @identified="onIdentified"
      />

      <section v-if="meta && meta.cast.length" class="cast" :aria-label="$t('match.cast')">
        <h2 class="th-display files__title">{{ $t('match.cast') }}</h2>
        <ul class="cast__list" role="list">
          <li v-for="c in meta.cast" :key="`${c.name}-${c.character}`" class="cast__item">
            <span class="cast__name">{{ c.name }}</span>
            <span v-if="c.character" class="th-muted cast__role">{{ c.character }}</span>
          </li>
        </ul>
      </section>

      <!-- Series: season tabs and the episode list -->
      <section v-if="isSeries" class="episodes">
        <v-tabs v-model="season" color="primary" show-arrows class="mb-4" :aria-label="$t('detail.seasons')">
          <v-tab v-for="g in seasons" :key="g.id" :value="g.id">{{ g.label }}<span class="th-muted tab-count">{{ g.episodes.length }}</span></v-tab>
        </v-tabs>
        <ul class="eplist" role="list">
          <li v-for="f in shown" :key="f.id" class="ep" :class="{ 'ep--dim': f.state !== 'available' }">
            <button type="button" class="ep__row" :aria-expanded="expanded === f.id" @click="expanded = expanded === f.id ? null : f.id">
              <span class="ep__code th-mono">{{ episodeCode(f.season, f.episode, f.episodeEnd) || '·' }}</span>
              <span class="ep__name">
                <span class="ep__title">{{ episodeName(f) }}</span>
                <span v-if="episodeName(f) !== f.fileName" class="ep__file th-muted">{{ f.fileName }}</span>
              </span>
              <span class="ep__meta">
                <v-chip v-if="f.state === 'source_offline'" size="x-small" color="warning" label variant="tonal">{{ $t('files.offline') }}</v-chip>
                <v-chip v-else-if="f.state === 'missing_unconfirmed'" size="x-small" color="error" label variant="tonal">{{ $t('files.missing') }}</v-chip>
                <v-chip v-if="f.probeError" size="x-small" color="error" label variant="outlined" :title="f.probeError">{{ $t('files.unreadable') }}</v-chip>
                <v-chip v-else-if="resolutionLabel(f.width, f.height)" size="x-small" label variant="outlined">{{ resolutionLabel(f.width, f.height) }}</v-chip>
                <span class="th-muted num">{{ formatDuration(f.durationMs, locale) }}</span>
              </span>
            </button>
            <div v-if="expanded === f.id" class="ep__facts">
              <div v-if="infoFor(f)?.overview || infoFor(f)?.stillUrl" class="ep__about">
                <img v-if="infoFor(f)?.stillUrl" class="ep__still" :src="connection.assetUrl(infoFor(f)?.stillUrl) ?? ''" alt="" loading="lazy" decoding="async" />
                <div>
                  <p v-if="infoFor(f)?.overview" class="ep__overview">{{ infoFor(f)?.overview }}</p>
                  <p v-if="infoFor(f)?.airDate" class="th-muted text-caption">{{ $t('match.aired', { date: infoFor(f)?.airDate }) }}</p>
                </div>
              </div>
              <FileFacts :file="f" />
            </div>
          </li>
        </ul>
      </section>

      <!-- Movies and videos: the file(s) behind the title -->
      <section v-else class="files">
        <h2 class="th-display files__title">{{ files.length > 1 ? $t('detail.versionsTitle') : $t('detail.file') }}</h2>
        <div v-for="f in files" :key="f.id" class="file th-hairline" :class="{ 'ep--dim': f.state !== 'available' }">
          <div class="file__head">
            <span class="th-mono file__name">{{ f.fileName }}</span>
            <v-chip v-if="f.state === 'source_offline'" size="x-small" color="warning" label variant="tonal">{{ $t('files.offline') }}</v-chip>
            <v-chip v-else-if="f.state === 'missing_unconfirmed'" size="x-small" color="error" label variant="tonal">{{ $t('files.missing') }}</v-chip>
          </div>
          <FileFacts :file="f" />
        </div>
      </section>

      <p v-if="meta" class="attribution th-muted">{{ $t('match.attribution') }}</p>
    </template>
  </div>
</template>

<style scoped>
.detail {
  padding-top: 16px;
}
.back {
  margin-left: -12px;
  margin-bottom: 8px;
}
.hero {
  display: grid;
  grid-template-columns: minmax(150px, 260px) minmax(0, 1fr);
  gap: clamp(20px, 4vw, 48px);
  align-items: end;
  padding: clamp(16px, 3vw, 32px);
  border-radius: calc(var(--th-radius) + 4px);
  background: linear-gradient(135deg, rgb(var(--v-theme-surface-light)), rgb(var(--v-theme-surface)));
  border: 1px solid rgb(var(--v-theme-hairline));
}
.hero__title {
  font-size: clamp(2rem, 4.5vw, 3.4rem);
  margin: 4px 0 16px;
  outline: none;
}
.chips {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
}
.original {
  margin: -8px 0 12px;
}
.tagline {
  font-style: italic;
  margin: -4px 0 12px;
  opacity: 0.85;
}
.overview {
  max-width: 68ch;
  margin: 16px 0 0;
  line-height: 1.55;
}
.match {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.match > :first-child {
  flex: 1 1 360px;
}
.match__line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
}
.cast {
  margin-top: 32px;
}
.cast__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px 24px;
}
.cast__item {
  display: grid;
}
.cast__name {
  font-weight: 600;
}
.cast__role {
  font-size: 0.85rem;
}
.ep__about {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}
.ep__still {
  flex: none;
  width: 160px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 8px;
}
.ep__overview {
  margin: 0 0 6px;
  line-height: 1.5;
}
.attribution {
  margin: 32px 0 0;
  font-size: 0.78rem;
}
.cta {
  margin-top: 24px;
  display: grid;
  gap: 6px;
  justify-items: start;
}
.cta p {
  margin: 0;
}
.episodes,
.files {
  margin-top: 32px;
}
.tab-count {
  margin-left: 8px;
  font-size: 0.75rem;
}
.eplist {
  list-style: none;
  padding: 0;
  margin: 0;
  border: 1px solid rgb(var(--v-theme-hairline));
  border-radius: var(--th-radius);
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.ep {
  border-bottom: 1px solid rgba(var(--v-theme-hairline), 0.6);
}
.ep:last-child {
  border-bottom: 0;
}
.ep--dim .ep__name,
.ep--dim .ep__code {
  opacity: 0.6;
}
.ep__row {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.ep__row:hover {
  background: rgb(var(--v-theme-surface-light));
}
.ep__code {
  flex: none;
  min-width: 5.5em;
  color: rgb(var(--v-theme-primary));
}
.ep__name {
  flex: 1;
  min-width: 0;
  display: grid;
}
.ep__title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep__file {
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  font-size: 0.82rem;
}
.num {
  min-width: 3.5em;
  text-align: right;
}
.ep__facts {
  padding: 4px 16px 16px calc(16px + 5.5em + 16px);
}
.files__title {
  font-size: 1.35rem;
  margin: 0 0 12px;
}
.file {
  border-radius: var(--th-radius);
  padding: 16px;
  margin-bottom: 12px;
  background: rgb(var(--v-theme-surface));
}
.file__head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.file__name {
  word-break: break-all;
}
.gone {
  text-align: center;
  padding: 64px 0;
}
@media (max-width: 700px) {
  .hero {
    grid-template-columns: 1fr;
    align-items: start;
  }
  .hero__poster {
    max-width: 200px;
  }
  .ep__row {
    flex-wrap: wrap;
  }
  .ep__facts {
    padding-left: 16px;
  }
}
</style>
