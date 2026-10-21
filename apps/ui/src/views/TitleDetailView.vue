<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { mdiArrowLeft, mdiCheckCircle, mdiCheckCircleOutline, mdiCloudOffOutline, mdiDotsVertical, mdiEye, mdiStar } from '@mdi/js'
import { z } from 'zod'
import { TitleDetail, type EpisodeInfo, type EpisodeStatus, type MediaFile } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import AddToCollectionMenu from '@/components/collections/AddToCollectionMenu.vue'
import FileFacts from '@/components/titles/FileFacts.vue'
import RenameDialog from '@/components/files/RenameDialog.vue'
import IdentifyDialog from '@/components/titles/IdentifyDialog.vue'
import PlayButton from '@/components/titles/PlayButton.vue'
import PosterArt from '@/components/titles/PosterArt.vue'
import { useSceneHint } from '@/composables/useSceneHint'
import { useConnectionStore } from '@/stores/connection'
import { useMetadataStore } from '@/stores/metadata'
import { usePlayersStore } from '@/stores/players'
import { episodeCode, formatBytes, formatClock, formatDuration, resolutionLabel } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const connection = useConnectionStore()
const metadataStore = useMetadataStore()
const players = usePlayersStore()
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

async function onFileHidden(): Promise<void> {
  await load()
  if (missing.value) back()
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
// The 3D backdrop (immersive mode) can follow this title's kind and its most characteristic genre.
useSceneHint(() => ({ kind: summary.value?.kind ?? null, genres: meta.value?.genres ?? [], genreOrder: 'priority' }))
const match = computed(() => detail.value?.match ?? null)
const canIdentify = computed(() => summary.value !== null && summary.value.kind !== 'video')
const posterSrc = computed(() => connection.assetUrl(meta.value?.posterUrl ?? summary.value?.posterUrl))
const heroStyle = computed(() => {
  const backdrop = connection.assetUrl(meta.value?.backdropUrl)
  if (!backdrop) return {}
  const veil = 'linear-gradient(90deg, rgba(var(--v-theme-surface), 0.76), rgba(var(--v-theme-surface), 0.94) 48%, rgba(var(--v-theme-surface), 0.98))'
  return { backgroundImage: `${veil}, url("${backdrop}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
})
const ratingText = computed(() => {
  const r = meta.value?.rating
  if (!r) return ''
  return t('match.rating', { source: r.source.toUpperCase(), value: r.value.toFixed(1), votes: new Intl.NumberFormat(locale.value).format(r.votes) })
})

// --- playing and watching -----------------------------------------------------
const playable = (f: MediaFile): boolean => f.state === 'available'

/** What the big Play button starts: a film's best file, a series' next episode (or the first one once all are watched). */
const playTarget = computed<{ fileId: number | null; label: string; reason: string | null; resumable: boolean }>(() => {
  const s = summary.value
  if (!s) return { fileId: null, label: t('detail.play'), reason: null, resumable: false }
  const offlineReason = t('play.unavailable')
  if (s.kind === 'series') {
    const next = detail.value?.playback.next
    if (next) {
      const f = files.value.find((x) => x.id === next.fileId)
      const resumable = next.resumeSeconds !== null
      const label = resumable ? t('play.resumeLabel', { label: next.label, time: formatClock(next.resumeSeconds) }) : t('play.next', { label: next.label })
      return { fileId: next.fileId, label, reason: f && playable(f) ? null : offlineReason, resumable }
    }
    const first = [...files.value].filter((f) => f.kind === 'episode' && f.season !== 0).sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))[0]
    const label = s.watchState === 'all' ? t('play.again') : t('detail.play')
    return first ? { fileId: first.id, label, reason: playable(first) ? null : offlineReason, resumable: false } : { fileId: null, label, reason: offlineReason, resumable: false }
  }
  const best = files.value.find((x) => playable(x) && x.positionSeconds !== null) ?? files.value.find(playable) ?? files.value[0]
  const resumable = best?.positionSeconds != null
  const label = resumable ? t('play.resumeFilm', { time: formatClock(best!.positionSeconds) }) : s.watchState === 'all' ? t('play.again') : t('detail.play')
  return best ? { fileId: best.id, label, reason: playable(best) ? null : offlineReason, resumable } : { fileId: null, label, reason: offlineReason, resumable: false }
})
const blockedReason = computed(() => (players.canPlay ? playTarget.value.reason : t('play.needsApp')))

const playNotice = ref<string | null>(null)
function onPlayed(ok: boolean): void {
  if (ok) return
  const failure = players.lastFailure
  playNotice.value = failure?.message ?? t(failure?.code === 'no_player' ? 'play.noPlayer' : 'play.failed')
}

const Changed = z.object({ changed: z.number().int() })
async function setWatched(path: string, body: unknown): Promise<void> {
  if (!connection.client) return
  try {
    await connection.client.put(path, body, Changed)
    await load()
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}
const setFileWatched = (f: MediaFile, watched: boolean): Promise<void> => setWatched(`/playback/files/${f.id}`, { watched })
const setTitleWatched = (watched: boolean, seasonNumber?: number): Promise<void> =>
  setWatched('/playback/titles', { key: key.value, watched, ...(seasonNumber === undefined ? {} : { season: seasonNumber }) })
const currentSeasonNumber = computed(() => (/^\d+$/.test(season.value) ? Number(season.value) : undefined))

// --- identification ---------------------------------------------------
const identifyOpen = ref(false)
const renameOpen = ref(false)
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

type Gap = Exclude<EpisodeStatus, 'local'>
/** One line of the episode list: a file, or an episode the provider lists that has no file. */
interface EpisodeRow {
  id: string
  file: MediaFile | null
  info: EpisodeInfo | null
  gap: Gap | null
  /** The file's season/episode is not in the provider's list. */
  stray: boolean
  /** More than one file plays this episode. */
  copies: number
  code: string
  sort: number
}
interface SeasonGroup {
  id: string
  label: string
  rows: EpisodeRow[]
  local: number
  missing: number
  summary: string | null
}

const fileRow = (f: MediaFile, info: EpisodeInfo | null, stray: boolean, copies: number): EpisodeRow => ({
  id: `f${f.id}`,
  file: f,
  info,
  gap: null,
  stray,
  copies,
  code: episodeCode(f.season, f.episode, f.episodeEnd),
  sort: f.episode ?? 1e6,
})

/**
 * Season tabs. With the provider's episode list the rows are the provider's episodes (a file, or a clearly
 * marked gap) plus any files the list does not know; without it, just the files grouped by their number.
 */
const seasons = computed<SeasonGroup[]>(() => {
  if (!isSeries.value) return []
  const label = (n: number): string => (n === 0 ? t('detail.specials') : t('detail.season', { n }))
  const cov = detail.value?.coverage
  const groups: SeasonGroup[] = []
  const placed = new Set<number>()

  if (cov) {
    const byId = new Map(files.value.map((f) => [f.id, f]))
    const strays = new Set(cov.unmatchedFileIds)
    for (const s of cov.seasons) {
      const rows: EpisodeRow[] = []
      for (const info of (detail.value?.episodes ?? []).filter((e) => e.season === s.season)) {
        if (info.fileIds.length === 0) {
          rows.push({ id: `g${info.season}-${info.episode}`, file: null, info, gap: info.status as Gap, stray: false, copies: 0, code: episodeCode(info.season, info.episode, null), sort: info.episode })
          continue
        }
        for (const fid of info.fileIds) {
          const f = byId.get(fid)
          if (!f || placed.has(fid)) continue // a range file is listed once, at its first episode
          placed.add(fid)
          rows.push(fileRow(f, info, false, info.fileIds.length))
        }
      }
      for (const f of files.value) {
        if (f.season === s.season && strays.has(f.id) && !placed.has(f.id)) {
          placed.add(f.id)
          rows.push(fileRow(f, null, true, 1))
        }
      }
      rows.sort((a, b) => a.sort - b.sort)
      const parts = [t('series.summary', { expected: s.expected, local: s.local })]
      if (s.missing) parts.push(t('series.missingN', { n: s.missing }))
      if (s.upcoming) parts.push(t('series.upcomingN', { n: s.upcoming }))
      if (s.undated) parts.push(t('series.undatedN', { n: s.undated }))
      groups.push({ id: String(s.season), label: label(s.season), rows, local: s.local, missing: s.missing, summary: parts.join(' · ') })
    }
    const rest = files.value.filter((f) => !placed.has(f.id))
    if (rest.length) groups.push({ id: 'none', label: t('detail.unnumbered'), rows: rest.map((f) => fileRow(f, null, true, 1)), local: rest.length, missing: 0, summary: null })
    return groups
  }

  const bySeason = new Map<number | null, MediaFile[]>()
  for (const f of files.value) bySeason.set(f.season, [...(bySeason.get(f.season) ?? []), f])
  for (const n of [...bySeason.keys()].filter((k): k is number => k !== null).sort((a, b) => a - b)) {
    const list = bySeason.get(n)!
    groups.push({ id: String(n), label: label(n), rows: list.map((f) => fileRow(f, null, false, 1)), local: list.length, missing: 0, summary: null })
  }
  const none = bySeason.get(null)
  if (none) groups.push({ id: 'none', label: t('detail.unnumbered'), rows: none.map((f) => fileRow(f, null, false, 1)), local: none.length, missing: 0, summary: null })
  return groups
})
watch(
  seasons,
  (groups) => {
    if (!groups.some((g) => g.id === season.value)) season.value = groups.find((g) => g.missing === 0)?.id ?? groups[0]?.id ?? ''
  },
  { immediate: true },
)
const shownGroup = computed(() => seasons.value.find((g) => g.id === season.value) ?? null)

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
            <li v-if="(summary.missingEpisodes ?? 0) > 0">
              <v-chip size="small" label variant="tonal" color="warning" data-test="missing-chip">{{ $t('series.missingN', { n: summary.missingEpisodes }) }}</v-chip>
            </li>
            <li v-if="ratingText">
              <v-chip size="small" label variant="tonal" color="primary" :prepend-icon="mdiStar" data-test="rating">{{ ratingText }}</v-chip>
            </li>
            <li v-for="g in meta?.genres ?? []" :key="g"><v-chip size="small" label variant="outlined">{{ g }}</v-chip></li>
          </ul>
          <p v-if="meta?.overview" class="overview" data-test="overview">{{ meta.overview }}</p>

          <v-alert v-if="offline" type="warning" variant="tonal" density="compact" :icon="mdiCloudOffOutline" class="mt-4">{{ $t('files.offlineHint') }}</v-alert>

          <div class="cta">
            <div class="cta__row">
              <PlayButton :file-id="playTarget.fileId" :label="playTarget.label" :blocked-reason="blockedReason" :resumable="playTarget.resumable" @played="onPlayed" />
              <v-menu location="bottom start">
                <template #activator="{ props: menuProps }">
                  <v-btn v-bind="menuProps" variant="outlined" class="th-btn-quiet" :prepend-icon="mdiEye" data-test="watched-menu">{{ summary.watchState === 'all' ? $t('play.watched') : $t('play.watchedMenu') }}</v-btn>
                </template>
                <v-list density="compact">
                  <v-list-item :title="$t('play.markAllWatched')" data-test="mark-all-watched" @click="setTitleWatched(true)" />
                  <v-list-item :title="$t('play.markAllUnwatched')" @click="setTitleWatched(false)" />
                  <template v-if="isSeries && currentSeasonNumber !== undefined">
                    <v-divider />
                    <v-list-item :title="$t('play.markSeasonWatched', { season: shownGroup?.label ?? '' })" @click="setTitleWatched(true, currentSeasonNumber)" />
                    <v-list-item :title="$t('play.markSeasonUnwatched', { season: shownGroup?.label ?? '' })" @click="setTitleWatched(false, currentSeasonNumber)" />
                  </template>
                </v-list>
              </v-menu>
              <AddToCollectionMenu :title-key="summary.key" :member-of="detail?.collections ?? []" @changed="load" />
              <v-btn v-if="summary.kind !== 'video'" variant="text" class="th-btn-quiet th-btn-quiet--text cta__rename" data-test="rename-files" @click="renameOpen = true">{{ $t('detail.renameFiles') }}</v-btn>
            </div>
            <p v-if="!players.canPlay" class="th-muted text-caption">{{ $t('play.needsAppHint') }}</p>
            <p v-else-if="playTarget.reason" class="th-muted text-caption">{{ playTarget.reason }}</p>
          </div>
        </div>
      </section>

      <section v-if="detail?.collections.length" class="partof" :aria-label="$t('collections.partOf')" data-test="part-of">
        <span class="th-muted">{{ $t('collections.partOf') }}</span>
        <router-link v-for="c in detail.collections" :key="c.id" :to="{ name: 'collection', query: { id: c.id } }" class="partof__link">{{ c.name }}</router-link>
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

      <RenameDialog v-if="summary.kind !== 'video'" v-model="renameOpen" :title-key="summary.key" :kind="summary.kind" @renamed="load" />

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
          <v-tab v-for="g in seasons" :key="g.id" :value="g.id">
            {{ g.label }}<span class="th-muted tab-count">{{ g.local }}</span>
            <v-chip v-if="g.missing" size="x-small" color="warning" variant="tonal" label class="ml-2">{{ $t('series.missingN', { n: g.missing }) }}</v-chip>
          </v-tab>
        </v-tabs>
        <p v-if="shownGroup?.summary" class="th-muted season-summary" data-test="season-summary">{{ shownGroup.summary }}</p>
        <ul class="eplist" role="list">
          <template v-for="r in shownGroup?.rows ?? []" :key="r.id">
            <!-- An episode the provider lists but there is no file for: never a button, never playable. -->
            <li v-if="!r.file" class="ep ep--gap" :data-gap="r.gap">
              <div class="ep__row ep__row--static">
                <span class="ep__code th-mono">{{ r.code }}</span>
                <span class="ep__name"><span class="ep__title">{{ r.info?.name || $t('series.untitled') }}</span></span>
                <span class="ep__meta">
                  <v-chip v-if="r.gap === 'missing'" size="x-small" color="warning" label variant="tonal">{{ $t('series.missing') }}</v-chip>
                  <v-chip v-else-if="r.gap === 'upcoming'" size="x-small" label variant="outlined">{{ $t('series.airs', { date: r.info?.airDate ?? '' }) }}</v-chip>
                  <v-chip v-else size="x-small" label variant="outlined" :title="$t('series.undatedHint')">{{ $t('series.undated') }}</v-chip>
                </span>
              </div>
            </li>
            <li v-else class="ep" :class="{ 'ep--dim': r.file.state !== 'available', 'ep--watched': r.file.watched }">
              <div class="ep__line">
              <button type="button" class="ep__row" :aria-expanded="expanded === r.file.id" @click="expanded = expanded === r.file.id ? null : r.file.id">
                <span class="ep__code th-mono">{{ r.code || '·' }}</span>
                <span class="ep__name">
                  <span class="ep__title">{{ episodeName(r.file) }}</span>
                  <span v-if="episodeName(r.file) !== r.file.fileName" class="ep__file th-muted">{{ r.file.fileName }}</span>
                </span>
                <span class="ep__meta">
                  <v-chip v-if="r.copies > 1" size="x-small" color="warning" label variant="outlined" :title="$t('series.copiesHint')">{{ $t('series.copies', { n: r.copies }) }}</v-chip>
                  <v-chip v-if="r.stray" size="x-small" label variant="outlined" :title="$t('series.strayHint')">{{ $t('series.stray') }}</v-chip>
                  <v-chip v-if="r.file.state === 'source_offline'" size="x-small" color="warning" label variant="tonal">{{ $t('files.offline') }}</v-chip>
                  <v-chip v-else-if="r.file.state === 'missing_unconfirmed'" size="x-small" color="error" label variant="tonal">{{ $t('files.missing') }}</v-chip>
                  <v-chip v-if="r.file.probeError" size="x-small" color="error" label variant="outlined" :title="r.file.probeError">{{ $t('files.unreadable') }}</v-chip>
                  <v-chip v-else-if="resolutionLabel(r.file.width, r.file.height)" size="x-small" label variant="outlined">{{ resolutionLabel(r.file.width, r.file.height) }}</v-chip>
                  <v-chip v-if="r.file.positionSeconds !== null" size="x-small" label variant="tonal" color="primary" data-test="stopped-at">{{ $t('play.stoppedAt', { time: formatClock(r.file.positionSeconds) }) }}</v-chip>
                  <span class="th-muted num">{{ formatDuration(r.file.durationMs, locale) }}</span>
                </span>
              </button>
              <div class="ep__actions">
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  :aria-pressed="r.file.watched"
                  :aria-label="r.file.watched ? $t('play.markUnwatched', { name: episodeName(r.file) }) : $t('play.markWatched', { name: episodeName(r.file) })"
                  :title="r.file.watched ? $t('play.watched') : $t('play.markWatchedShort')"
                  data-test="toggle-watched"
                  @click="setFileWatched(r.file, !r.file.watched)"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path :d="r.file.watched ? mdiCheckCircle : mdiCheckCircleOutline" fill="currentColor" /></svg>
                </v-btn>
                <PlayButton
                  icon
                  :file-id="r.file.id"
                  :label="$t('play.episode', { name: episodeName(r.file) })"
                  :blocked-reason="players.canPlay ? (playable(r.file) ? null : $t('play.unavailable')) : $t('play.needsApp')"
                  @played="onPlayed"
                />
              </div>
              </div>
              <div v-if="expanded === r.file.id" class="ep__facts">
                <div v-if="infoFor(r.file)?.overview || infoFor(r.file)?.stillUrl" class="ep__about">
                  <img v-if="infoFor(r.file)?.stillUrl" class="ep__still" :src="connection.assetUrl(infoFor(r.file)?.stillUrl) ?? ''" alt="" loading="lazy" decoding="async" />
                  <div>
                    <p v-if="infoFor(r.file)?.overview" class="ep__overview">{{ infoFor(r.file)?.overview }}</p>
                    <p v-if="infoFor(r.file)?.airDate" class="th-muted text-caption">{{ $t('match.aired', { date: infoFor(r.file)?.airDate }) }}</p>
                  </div>
                </div>
                <FileFacts :file="r.file" @hidden="onFileHidden" />
              </div>
            </li>
          </template>
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
            <v-chip v-if="f.watched" size="x-small" label variant="tonal" color="success">{{ $t('play.watched') }}</v-chip>
            <v-chip v-else-if="f.positionSeconds !== null" size="x-small" label variant="tonal" color="primary" data-test="stopped-at">{{ $t('play.stoppedAt', { time: formatClock(f.positionSeconds) }) }}</v-chip>
            <span class="file__spacer" />
            <PlayButton
              v-if="files.length > 1"
              :file-id="f.id"
              :label="$t('play.version', { name: f.fileName })"
              :blocked-reason="players.canPlay ? (playable(f) ? null : $t('play.unavailable')) : $t('play.needsApp')"
              icon
              @played="onPlayed"
            />
          </div>
          <FileFacts :file="f" @hidden="onFileHidden" />
        </div>
      </section>

      <v-snackbar :model-value="playNotice !== null" :timeout="6000" color="error" role="alert" @update:model-value="playNotice = null">{{ playNotice }}</v-snackbar>

      <p v-if="meta" class="attribution th-muted">{{ $t('match.attribution') }}</p>
    </template>
  </div>
</template>

<style scoped>
.detail {
  padding-top: 16px;
  max-width: 1600px;
}
.back {
  margin-left: -12px;
  margin-bottom: 8px;
}
.hero {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: clamp(24px, 4vw, 56px);
  align-items: start;
  padding: clamp(20px, 3vw, 40px);
  border-radius: calc(var(--th-radius) + 8px);
  background: linear-gradient(135deg, rgb(var(--v-theme-surface-light)), rgb(var(--v-theme-surface)));
  border: 1px solid rgb(var(--v-theme-hairline));
  overflow: hidden;
}
.hero__poster {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 240px;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--th-radius);
  align-self: start;
}
.hero__info {
  position: relative;
  z-index: 1;
  min-width: 0;
  align-self: center;
  padding-block: clamp(4px, 2vw, 24px);
}
.hero__title {
  max-width: 22ch;
  font-size: clamp(2.25rem, 4.5vw, 4rem);
  line-height: 1.02;
  overflow-wrap: anywhere;
  margin: 6px 0 14px;
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
.chips :deep(.v-chip) {
  max-width: 100%;
}
.season-summary {
  margin: -4px 0 12px;
  font-size: 0.88rem;
}
.ep--gap .ep__row {
  cursor: default;
  opacity: 0.8;
}
.ep--gap {
  background: repeating-linear-gradient(135deg, transparent 0 10px, rgba(var(--v-theme-on-surface), 0.035) 10px 20px);
}
.ep__row--static:hover {
  background: transparent;
}
.partof {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  font-size: 0.9rem;
}
.partof__link {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  text-decoration: none;
}
.partof__link:hover {
  text-decoration: underline;
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
  max-width: 72ch;
  margin: 20px 0 0;
  line-height: 1.65;
  text-wrap: pretty;
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
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid rgba(var(--v-theme-hairline), 0.72);
  display: grid;
  gap: 10px;
  justify-items: stretch;
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
.cta__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
/* The least-used action sits apart, at the far end, so the row reads Play first. */
.cta__rename {
  margin-inline-start: auto;
}
@media (max-width: 600px) {
  .cta__row > :first-child {
    flex: 1 1 100%;
  }
  .cta__row :deep(.play) {
    width: 100%;
  }
  .cta__row :deep(.play__main) {
    flex: 1 1 auto;
  }
  .cta__rename {
    margin-inline-start: 0;
  }
}
.ep__line {
  display: flex;
  align-items: center;
}
.ep__actions {
  display: flex;
  align-items: center;
  padding-right: 8px;
  flex: none;
}
.ep--watched .ep__title,
.ep--watched .ep__code {
  opacity: 0.55;
}
.file__spacer {
  flex: 1;
}
.ep__row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-width: 0;
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
@media (max-width: 900px) {
  .hero {
    grid-template-columns: minmax(150px, 200px) minmax(0, 1fr);
    gap: 24px;
  }
  .hero__poster {
    max-width: 200px;
  }
  .hero__title {
    font-size: clamp(2rem, 6vw, 3rem);
  }
}
@media (max-width: 640px) {
  .hero {
    grid-template-columns: 1fr;
    align-items: start;
  }
  .hero__poster {
    width: min(58vw, 220px);
    max-width: none;
  }
  .hero__info {
    width: 100%;
    padding-block: 0;
  }
  .hero__title {
    max-width: none;
  }
  .ep__row {
    flex-wrap: wrap;
    gap: 8px 12px;
  }
  .ep__line {
    align-items: flex-start;
  }
  .ep__meta {
    width: 100%;
    flex-wrap: wrap;
  }
  .ep__actions {
    padding-top: 8px;
  }
  .file__head {
    flex-wrap: wrap;
  }
  .ep__facts {
    padding-left: 16px;
  }
}
</style>
