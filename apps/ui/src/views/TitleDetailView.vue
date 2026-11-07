<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { mdiCheckCircle, mdiCheckCircleOutline, mdiCloudOffOutline, mdiDotsVertical, mdiEye, mdiOpenInNew, mdiStar, mdiYoutube } from '@mdi/js'
import { z } from 'zod'
import { DismissContinueResult, TitleDetail, type EpisodeInfo, type EpisodeStatus, type ExternalLinkRequest, type MediaFile } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import AddToCollectionMenu from '@/components/collections/AddToCollectionMenu.vue'
import FileFacts from '@/components/titles/FileFacts.vue'
import AwardsList from '@/components/titles/AwardsList.vue'
import CreditPopover from '@/components/titles/CreditPopover.vue'
import RenameDialog from '@/components/files/RenameDialog.vue'
import IdentifyDialog from '@/components/titles/IdentifyDialog.vue'
import PathSwitch from '@/components/titles/PathSwitch.vue'
import PlayButton from '@/components/titles/PlayButton.vue'
import { episodeChoiceKey, groupEpisodeFiles, loadChoices, movieChoiceKey, resolveChoice, saveChoice } from '@/components/titles/variants'
import TrailerDialog from '@/components/titles/TrailerDialog.vue'
import PosterArt from '@/components/titles/PosterArt.vue'
import imdbLogo from '@/assets/brand/imdb.png'
import tmdbLogo from '@/assets/brand/tmdb.png'
import GlyphIcon from '@/components/icons/GlyphIcon.vue'
import { imdbLinkFor, openExternal as openLink, trailerInApp } from '@/composables/useExternalLinks'
import { useSceneHint } from '@/composables/useSceneHint'
import { useLatestRequest, useRefresh } from '@/composables/useRefresh'
import { useConnectionStore } from '@/stores/connection'
import { useDownloadsStore } from '@/stores/downloads'
import { useLibraryStore } from '@/stores/library'
import { useTitleActionsStore } from '@/stores/titleActions'
import { useMetadataStore } from '@/stores/metadata'
import { usePlayersStore } from '@/stores/players'
import { episodeCode, formatBytes, formatClock, formatDuration, resolutionLabel } from '@/utils/format'
import { downloadProgressFor } from '@/utils/posterProgress'
import { releaseSearchRoute } from '@/utils/releaseSearch'

const route = useRoute()
const router = useRouter()
const connection = useConnectionStore()
const metadataStore = useMetadataStore()
const downloadsStore = useDownloadsStore()
const library = useLibraryStore()
const notices = useTitleActionsStore()
const players = usePlayersStore()
const { t, locale } = useI18n()

const detail = ref<TitleDetail | null>(null)
const missing = ref(false)
const error = ref<string | null>(null)
const season = ref<string>('')
const heading = ref<HTMLElement | null>(null)

const key = computed(() => String(route.query.key ?? ''))

/** Release search requires Prowlarr; qBittorrent is used when a result is chosen. */
const canFindDownload = computed(() => downloadsStore.canFindReleases)

const latest = useLatestRequest()
const refresh = useRefresh(load)

async function load(): Promise<void> {
  const client = connection.client
  if (!client || !key.value) return
  await latest(signal => client.get('/library/title', TitleDetail, { key: key.value }, { signal }), result => {
    detail.value = result
    missing.value = false
    error.value = null
  }, err => {
    if (err instanceof ApiRequestError && err.code === 'not_found') {
      detail.value = null
      missing.value = true
    } else error.value = err instanceof Error ? err.message : String(err)
  })
}

async function onFileHidden(): Promise<void> {
  await load()
  if (missing.value) back()
}

/** Drops one of several paths for the same movie or episode; the file stays on disk and can be restored from Library exclusions. */
async function removePath(id: number): Promise<void> {
  const ok = await library.hideFile(id)
  notices.notify(ok ? t('detail.pathRemoved') : (library.error ?? t('titles.actions.failed')), !ok)
  if (ok) await onFileHidden()
}

watch([() => connection.phase, key], () => connection.phase === 'connected' && void load().then(() => nextTick(() => heading.value?.focus())), { immediate: true })
const off = connection.onEvent((e) => {
  if (e.type === 'library.changed' || e.type === 'scan.finished') refresh.schedule()
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
/** A movie still downloading: how far along (0–1), so the poster fills in. */
const posterProgress = computed(() => (summary.value?.kind === 'movie' ? downloadProgressFor(downloadsStore.list?.items, summary.value.tmdbId) : null))
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
const tmdbLink = computed<ExternalLinkRequest | null>(() => {
  const m = meta.value
  const s = summary.value
  return m?.provider === 'tmdb' && s && s.kind !== 'video' && /^\d+$/.test(m.externalId)
    ? { service: 'tmdb', kind: s.kind, id: m.externalId }
    : null
})
const awardsSubject = computed(() => {
  const m = meta.value
  const s = summary.value
  return m?.provider === 'tmdb' && s && s.kind !== 'video' && /^\d+$/.test(m.externalId) ? { subject: s.kind, externalId: m.externalId } : null
})
const imdbLink = computed<ExternalLinkRequest | null>(() => imdbLinkFor(meta.value?.imdbId))
const trailerLink = computed<ExternalLinkRequest | null>(() =>
  meta.value?.trailer?.site === 'youtube' ? { service: 'youtube', id: meta.value.trailer.key } : null,
)

const trailerOpen = ref(false)

async function openExternal(link: ExternalLinkRequest): Promise<void> {
  actionError.value = null
  try {
    await openLink(link)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}

// --- playing and watching -----------------------------------------------------
const playable = (f: MediaFile): boolean => f.state === 'available'

// Several files can play one movie or episode: it is shown once, with a switch between the paths. The path the
// person picked is remembered on this device; until they pick one, the best available copy is used.
const choices = ref<Record<string, number>>(loadChoices())
function choose(choiceKey: string, fileId: number): void {
  choices.value = { ...choices.value, [choiceKey]: fileId }
  saveChoice(choiceKey, fileId)
}
/** The file a film plays. */
const movieFile = computed<MediaFile | null>(() => resolveChoice(files.value, choices.value[movieChoiceKey(key.value)]))
/** The file chosen for the episode a file belongs to (the file itself when it has no copies). */
const chosenByFile = computed(() => {
  const map = new Map<number, MediaFile>()
  for (const g of seasons.value) for (const r of g.rows) if (r.file) for (const v of r.variants) map.set(v.id, r.file)
  return map
})
const chosenFor = (f: MediaFile | undefined): MediaFile | undefined => (f ? (chosenByFile.value.get(f.id) ?? f) : undefined)

/** What the big Play button starts: a film's best file, a series' next episode (or the first one once all are watched). */
const playTarget = computed<{ fileId: number | null; label: string; reason: string | null; resumable: boolean }>(() => {
  const s = summary.value
  if (!s) return { fileId: null, label: t('detail.play'), reason: null, resumable: false }
  const offlineReason = t('play.unavailable')
  if (s.kind === 'series') {
    const next = detail.value?.playback.next
    if (next) {
      // The server names an available copy; the path the person switched to wins, with its own resume point.
      const f = chosenFor(files.value.find((x) => x.id === next.fileId))
      const resumeSeconds = f && f.id !== next.fileId ? f.positionSeconds : next.resumeSeconds
      const resumable = resumeSeconds !== null
      const label = resumable ? t('play.resumeLabel', { label: next.label, time: formatClock(resumeSeconds) }) : t('play.next', { label: next.label })
      return { fileId: f?.id ?? next.fileId, label, reason: f && playable(f) ? null : offlineReason, resumable }
    }
    const first = chosenFor([...files.value].filter((f) => f.kind === 'episode' && f.season !== 0).sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))[0])
    const label = s.watchState === 'all' ? t('play.again') : t('detail.play')
    return first ? { fileId: first.id, label, reason: playable(first) ? null : offlineReason, resumable: false } : { fileId: null, label, reason: offlineReason, resumable: false }
  }
  const best = movieFile.value
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

/** Forgets the remembered position of the file the big Play button would resume, so it starts from 0 again. */
async function resetPosition(): Promise<void> {
  const id = playTarget.value.fileId
  if (!connection.client || id === null) return
  try {
    await connection.client.delete(`/playback/files/${id}/position`, DismissContinueResult)
    await load()
  } catch (err) {
    notices.notify(err instanceof Error ? err.message : t('play.resetFailed'), true)
  }
}

const Changed = z.object({ changed: z.number().int() })
async function setWatched(path: string, body: unknown, ...more: string[]): Promise<void> {
  if (!connection.client) return
  try {
    for (const p of [path, ...more]) await connection.client.put(p, body, Changed)
    await load()
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}
/** An episode is watched when any of its files is, so marking it changes every copy; a hidden copy cannot undo it. */
const setEpisodeWatched = (copies: MediaFile[], watched: boolean): Promise<void> =>
  setWatched(`/playback/files/${copies[0]!.id}`, { watched }, ...copies.slice(1).map((f) => `/playback/files/${f.id}`))
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
/** One line of the episode list: an episode with its file(s), or an episode the provider lists that has no file. */
interface EpisodeRow {
  id: string
  /** The file in use: the one the person chose, else the best copy. */
  file: MediaFile | null
  /** Every file that plays this episode (two or more when it has copies); empty for a gap. */
  variants: MediaFile[]
  /** Where the person's choice among `variants` is remembered. */
  choiceKey: string
  /** Watched in any of its files. */
  watched: boolean
  info: EpisodeInfo | null
  gap: Gap | null
  /** The file's season/episode is not in the provider's list. */
  stray: boolean
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

/** A row for the files that play one episode; `variants` is never empty. */
function fileRow(variants: MediaFile[], info: EpisodeInfo | null, stray: boolean): EpisodeRow {
  const first = variants[0]!
  // A file without an episode number has no copies to tell it from, so its own id identifies it.
  const choiceKey = first.episode === null ? `${key.value}:f${first.id}` : episodeChoiceKey(key.value, info?.season ?? first.season, info?.episode ?? first.episode)
  const f = resolveChoice(variants, choices.value[choiceKey])!
  return {
    id: `f${first.id}`,
    file: f,
    variants,
    choiceKey,
    watched: variants.some((v) => v.watched),
    info,
    gap: null,
    stray,
    code: episodeCode(f.season, f.episode, f.episodeEnd),
    sort: f.episode ?? 1e6,
  }
}

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
    const episodesBySeason = new Map<number, EpisodeInfo[]>()
    const filesBySeason = new Map<number | null, MediaFile[]>()
    for (const info of detail.value?.episodes ?? []) {
      const group = episodesBySeason.get(info.season) ?? []
      group.push(info)
      episodesBySeason.set(info.season, group)
    }
    for (const file of files.value) {
      const group = filesBySeason.get(file.season) ?? []
      group.push(file)
      filesBySeason.set(file.season, group)
    }
    for (const s of cov.seasons) {
      const rows: EpisodeRow[] = []
      for (const info of (episodesBySeason.get(s.season) ?? [])) {
        if (info.fileIds.length === 0) {
          rows.push({ id: `g${info.season}-${info.episode}`, file: null, variants: [], choiceKey: '', watched: false, info, gap: info.status as Gap, stray: false, code: episodeCode(info.season, info.episode, null), sort: info.episode })
          continue
        }
        // Copies of one episode share one row; a range file is listed once, at its first episode.
        const variants = info.fileIds.map((fid) => byId.get(fid)).filter((f): f is MediaFile => f !== undefined && !placed.has(f.id))
        if (variants.length === 0) continue
        for (const f of variants) placed.add(f.id)
        rows.push(fileRow(variants, info, false))
      }
      const strayFiles = (filesBySeason.get(s.season) ?? []).filter((f) => f.season === s.season && strays.has(f.id) && !placed.has(f.id))
      for (const copies of groupEpisodeFiles(strayFiles)) {
        for (const f of copies) placed.add(f.id)
        rows.push(fileRow(copies, null, true))
      }
      rows.sort((a, b) => a.sort - b.sort)
      const parts = [t('series.summary', { expected: s.expected, local: s.local })]
      if (s.missing) parts.push(t('series.missingN', { n: s.missing }))
      if (s.upcoming) parts.push(t('series.upcomingN', { n: s.upcoming }))
      if (s.undated) parts.push(t('series.undatedN', { n: s.undated }))
      groups.push({ id: String(s.season), label: label(s.season), rows, local: s.local, missing: s.missing, summary: parts.join(' · ') })
    }
    const rest = files.value.filter((f) => !placed.has(f.id))
    const restRows = groupEpisodeFiles(rest).map((copies) => fileRow(copies, null, true))
    if (restRows.length) groups.push({ id: 'none', label: t('detail.unnumbered'), rows: restRows, local: restRows.length, missing: 0, summary: null })
    return groups
  }

  const bySeason = new Map<number | null, MediaFile[]>()
  for (const f of files.value) {
    const group = bySeason.get(f.season) ?? []
    group.push(f)
    bySeason.set(f.season, group)
  }
  for (const n of [...bySeason.keys()].filter((k): k is number => k !== null).sort((a, b) => a - b)) {
    const rows = groupEpisodeFiles(bySeason.get(n)!).map((copies) => fileRow(copies, null, false))
    groups.push({ id: String(n), label: label(n), rows, local: rows.length, missing: 0, summary: null })
  }
  const none = bySeason.get(null)
  if (none) {
    const rows = groupEpisodeFiles(none).map((copies) => fileRow(copies, null, false))
    groups.push({ id: 'none', label: t('detail.unnumbered'), rows, local: rows.length, missing: 0, summary: null })
  }
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
const expanded = ref<string | null>(null)

const metaChips = computed(() => {
  const s = summary.value
  if (!s) return []
  const chips: string[] = []
  if (s.year) chips.push(String(s.year))
  if (s.kind === 'series') {
    if (s.seasonCount > 0) chips.push(t('titles.seasons', s.seasonCount))
    chips.push(t('titles.episodes', s.episodeCount > 0 ? s.episodeCount : s.fileCount))
  } else {
    // The facts of the file in use; its copies are behind the path switch.
    const used = movieFile.value
    if (used?.durationMs) chips.push(formatDuration(used.durationMs, locale.value))
    else if (meta.value?.runtimeMinutes) chips.push(formatDuration(meta.value.runtimeMinutes * 60_000, locale.value))
    const res = used ? resolutionLabel(used.width, used.height) : ''
    if (res) chips.push(res)
  }
  chips.push(formatBytes(s.kind === 'series' || !movieFile.value ? s.size : movieFile.value.size, locale.value))
  return chips
})
</script>

<template>
  <div class="th-page detail">
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
    <section v-if="missing" class="gone">
      <h1 class="th-display">{{ $t('detail.gone') }}</h1>
      <p class="th-muted">{{ $t('detail.goneHint') }}</p>
    </section>

    <template v-if="summary">
      <section class="hero" :style="heroStyle">
        <div class="hero__poster"><PosterArt :seed="summary.key" :title="summary.title" :year="summary.kind === 'movie' ? summary.year : null" :kind="summary.kind" :image-url="posterSrc" :progress="posterProgress" /></div>
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
              <v-chip
                size="small"
                label
                variant="tonal"
                color="primary"
                :prepend-icon="mdiStar"
                :link="Boolean(tmdbLink)"
                :role="tmdbLink ? 'link' : undefined"
                :aria-label="tmdbLink ? $t('detail.openTmdbRating', { rating: ratingText }) : undefined"
                data-test="rating"
                @click="tmdbLink && openExternal(tmdbLink)"
              >{{ ratingText }}</v-chip>
            </li>
            <li v-else-if="tmdbLink">
              <v-btn variant="text" size="small" class="th-brand-btn" :aria-label="$t('detail.openTmdb')" :title="$t('detail.openTmdb')" data-test="tmdb-link" @click="openExternal(tmdbLink)">
                <img :src="tmdbLogo" alt="" class="th-brand-btn__logo th-brand-btn__logo--sm" />
              </v-btn>
            </li>
            <li v-for="g in meta?.genres ?? []" :key="g"><v-chip size="small" label variant="outlined">{{ g }}</v-chip></li>
          </ul>
          <p v-if="meta?.overview" class="overview" data-test="overview">{{ meta.overview }}</p>

          <v-alert v-if="offline" type="warning" variant="tonal" density="compact" :icon="mdiCloudOffOutline" class="mt-4">{{ $t('files.offlineHint') }}</v-alert>

          <div class="cta">
            <div class="cta__row">
              <PlayButton :file-id="playTarget.fileId" :label="playTarget.label" :blocked-reason="blockedReason" :resumable="playTarget.resumable" @played="onPlayed" @reset="resetPosition" />
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
              <v-btn v-if="imdbLink" variant="text" class="th-brand-btn" :aria-label="$t('detail.imdb')" :title="$t('detail.imdb')" data-test="imdb-link" @click="openExternal(imdbLink)">
                <img :src="imdbLogo" alt="" class="th-brand-btn__logo" />
              </v-btn>
              <template v-if="trailerLink">
                <!-- Both ways to watch it: inside Theama (desktop app) and on YouTube in the browser. -->
                <v-btn-group v-if="trailerInApp" variant="outlined" divided density="comfortable" class="th-btn-quiet">
                  <v-btn data-test="trailer-play" @click="trailerOpen = true"><template #prepend><GlyphIcon name="play" /></template>{{ $t('detail.trailer') }}</v-btn>
                  <v-btn
                    :aria-label="$t('detail.trailerYoutubeHint')"
                    :title="$t('detail.trailerYoutubeHint')"
                    data-test="trailer-link"
                    @click="openExternal(trailerLink)"
                  >
                    <svg class="th-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiYoutube" fill="currentColor" /></svg>
                  </v-btn>
                </v-btn-group>
                <v-btn v-else variant="outlined" class="th-btn-quiet" :append-icon="mdiOpenInNew" data-test="trailer-link" @click="openExternal(trailerLink)">
                  <template #prepend><GlyphIcon name="play" /></template>{{ $t('detail.trailer') }}
                </v-btn>
              </template>
              <AddToCollectionMenu :title-key="summary.key" :member-of="detail?.collections ?? []" @changed="load" />
              <v-btn v-if="summary.kind !== 'video'" variant="text" class="th-btn-quiet th-btn-quiet--text cta__rename" data-test="rename-files" @click="renameOpen = true">{{ $t('detail.renameFiles') }}</v-btn>
              <v-btn
                v-if="summary.kind !== 'video' && canFindDownload"
                variant="text"
                class="th-btn-quiet th-btn-quiet--text"
                :to="{ name: 'downloads', query: { releases: '1', kind: summary.kind, title: meta?.title ?? summary.title, ...(summary.year ? { year: String(summary.year) } : {}), ...(summary.kind === 'movie' && summary.tmdbId ? { externalId: summary.tmdbId } : {}), ...(summary.kind === 'movie' && detail?.collections.find(c => c.kind === 'official') ? { collectionName: detail.collections.find(c => c.kind === 'official')?.name } : {}) } }"
                data-test="find-download"
              ><template #prepend><GlyphIcon name="calendar" /></template>{{ $t('detail.findDownload') }}</v-btn>
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

      <TrailerDialog
        v-if="trailerInApp && meta?.trailer"
        v-model="trailerOpen"
        :video-id="meta.trailer.key"
        :title="summary.title"
        @youtube="trailerLink && openExternal(trailerLink)"
      />
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

      <AwardsList v-if="awardsSubject" :subject="awardsSubject.subject" :external-id="awardsSubject.externalId" heading-level="h2" hide-when-empty />

      <section v-if="detail?.credits.length" class="cast" :aria-label="$t('detail.castAndCrew')">
        <h2 class="th-display files__title">{{ $t('detail.castAndCrew') }}</h2>
        <h3 v-if="detail.credits.some((credit) => credit.category === 'director')" class="cast__group">{{ $t('detail.directors') }}</h3>
        <ul class="cast__list" role="list">
          <li v-for="credit in detail.credits.filter((item) => item.category === 'director')" :key="`director-${credit.externalId}`" class="cast__item">
            <CreditPopover :credit="credit" />
          </li>
        </ul>
        <h3 v-if="detail.credits.some((credit) => credit.category === 'actor')" class="cast__group">{{ $t('match.cast') }}</h3>
        <ul class="cast__list" role="list">
          <li v-for="credit in detail.credits.filter((item) => item.category === 'actor')" :key="`actor-${credit.externalId}`" class="cast__item">
            <CreditPopover :credit="credit" />
          </li>
        </ul>
      </section>

      <!-- Series: season tabs and the episode list -->
      <section v-if="isSeries" class="episodes">
        <v-tabs v-model="season" color="primary" height="4.5rem" hide-slider show-arrows center-active class="season-nav" :aria-label="$t('detail.seasons')">
          <template #prev>
            <v-btn icon="$prev" variant="text" size="small" class="season-nav__arrow" :aria-label="$t('series.previousSeasons')" />
          </template>
          <v-tab v-for="g in seasons" :key="g.id" :value="g.id" :rounded="false" :ripple="false" class="season-nav__card">
            <span class="season-nav__label">{{ g.label }}</span>
            <span class="season-nav__meta">
              <span class="th-muted">{{ $t('series.inLibraryN', { n: g.local }) }}</span>
              <span v-if="g.missing" class="season-nav__missing">{{ $t('series.missingN', { n: g.missing }) }}</span>
            </span>
          </v-tab>
          <template #next>
            <v-btn icon="$next" variant="text" size="small" class="season-nav__arrow" :aria-label="$t('series.nextSeasons')" />
          </template>
        </v-tabs>
        <div class="season-summary">
          <p v-if="shownGroup?.summary" class="th-muted" data-test="season-summary">{{ shownGroup.summary }}</p>
          <v-btn
            v-if="canFindDownload && shownGroup?.missing && currentSeasonNumber !== undefined"
            :to="releaseSearchRoute({ kind: 'series', title: meta?.title ?? summary.title, season: currentSeasonNumber })"
            size="small"
            variant="tonal"
            class="gap-search"
            :aria-label="$t('series.findSeasonFor', { title: meta?.title ?? summary.title, season: shownGroup.label })"
            data-test="find-season-releases"
          ><template #prepend><GlyphIcon name="calendar" /></template>{{ $t('series.findSeason') }}</v-btn>
        </div>
        <ul class="eplist" role="list">
          <template v-for="r in shownGroup?.rows ?? []" :key="r.id">
            <!-- A gap stays non-playable; searching is a separate navigation action. -->
            <li v-if="!r.file" class="ep ep--gap" :data-gap="r.gap">
              <div class="ep__row ep__row--static">
                <span class="ep__code th-mono">{{ r.code }}</span>
                <span class="ep__name"><span class="ep__title">{{ r.info?.name || $t('series.untitled') }}</span></span>
                <span class="ep__meta">
                  <v-chip v-if="r.gap === 'missing'" size="x-small" color="warning" label variant="tonal">{{ $t('series.missing') }}</v-chip>
                  <v-chip v-else-if="r.gap === 'upcoming'" size="x-small" label variant="outlined">{{ $t('series.airs', { date: r.info?.airDate ?? '' }) }}</v-chip>
                  <v-chip v-else size="x-small" label variant="outlined" :title="$t('series.undatedHint')">{{ $t('series.undated') }}</v-chip>
                </span>
                <v-btn
                  v-if="canFindDownload && r.gap === 'missing' && r.info"
                  :to="releaseSearchRoute({ kind: 'series', title: meta?.title ?? summary.title, season: r.info.season, episode: r.info.episode })"
                  size="small"
                  variant="tonal"
                  class="gap-search"
                  :aria-label="$t('series.findEpisodeFor', { title: meta?.title ?? summary.title, episode: r.code })"
                  data-test="find-episode-releases"
                ><template #prepend><GlyphIcon name="calendar" /></template>{{ $t('series.findEpisode') }}</v-btn>
              </div>
            </li>
            <li v-else class="ep" :class="{ 'ep--dim': r.file.state !== 'available', 'ep--watched': r.watched }">
              <div class="ep__line">
              <button type="button" class="ep__row" :aria-expanded="expanded === r.id" @click="expanded = expanded === r.id ? null : r.id">
                <span class="ep__code th-mono">{{ r.code || '·' }}</span>
                <span class="ep__name">
                  <span class="ep__title">{{ episodeName(r.file) }}</span>
                  <span v-if="episodeName(r.file) !== r.file.fileName" class="ep__file th-muted">{{ r.file.fileName }}</span>
                </span>
                <span class="ep__meta">
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
                <PathSwitch
                  v-if="r.variants.length > 1"
                  compact
                  :variants="r.variants"
                  :model-value="r.file.id"
                  :name="episodeName(r.file)"
                  @update:model-value="choose(r.choiceKey, $event)"
                  @remove="removePath"
                />
                <v-btn
                  icon
                  size="small"
                  variant="text"
                  :aria-pressed="r.watched"
                  :aria-label="r.watched ? $t('play.markUnwatched', { name: episodeName(r.file) }) : $t('play.markWatched', { name: episodeName(r.file) })"
                  :title="r.watched ? $t('play.watched') : $t('play.markWatchedShort')"
                  data-test="toggle-watched"
                  @click="setEpisodeWatched(r.variants, !r.watched)"
                >
                  <svg class="th-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="r.watched ? mdiCheckCircle : mdiCheckCircleOutline" fill="currentColor" /></svg>
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
              <div v-if="expanded === r.id" class="ep__facts">
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

      <!-- Movies and videos: the file behind the title; its copies, if any, are behind the path switch. -->
      <section v-else-if="movieFile" class="files">
        <h2 class="th-display files__title">{{ $t('detail.file') }}</h2>
        <div class="file th-hairline" :class="{ 'ep--dim': movieFile.state !== 'available' }">
          <div class="file__head">
            <span class="th-mono file__name">{{ movieFile.fileName }}</span>
            <v-chip v-if="movieFile.state === 'source_offline'" size="x-small" color="warning" label variant="tonal">{{ $t('files.offline') }}</v-chip>
            <v-chip v-else-if="movieFile.state === 'missing_unconfirmed'" size="x-small" color="error" label variant="tonal">{{ $t('files.missing') }}</v-chip>
            <v-chip v-if="movieFile.watched" size="x-small" label variant="tonal" color="success">{{ $t('play.watched') }}</v-chip>
            <v-chip v-else-if="movieFile.positionSeconds !== null" size="x-small" label variant="tonal" color="primary" data-test="stopped-at">{{ $t('play.stoppedAt', { time: formatClock(movieFile.positionSeconds) }) }}</v-chip>
            <span class="file__spacer" />
            <PathSwitch
              v-if="files.length > 1"
              :variants="files"
              :model-value="movieFile.id"
              :name="summary.title"
              @update:model-value="choose(movieChoiceKey(summary.key), $event)"
              @remove="removePath"
            />
          </div>
          <FileFacts :file="movieFile" @hidden="onFileHidden" />
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
  max-width: 100rem;
}
.hero {
  display: grid;
  grid-template-columns: minmax(11rem, 15rem) minmax(0, 1fr);
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
  max-width: 15rem;
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
  font-size: clamp(2.25rem, calc(4.5vw * var(--th-text-scale)), 4rem);
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin: 0 0 12px;
  font-size: 0.88rem;
}
.season-summary p {
  margin: 0;
}
.gap-search {
  flex: 0 1 auto;
  height: auto !important;
  min-height: 2.25rem;
  max-width: 100%;
  padding-block: 8px;
  white-space: normal;
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
  flex: 1 1 22rem;
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
  grid-template-columns: repeat(auto-fill, minmax(min(14rem, 100%), 1fr));
  gap: 8px 24px;
}
.cast__group {
  margin: 18px 0 8px;
  font-size: 0.82rem;
  font-weight: 750;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
}
.cast__item {
  min-width: 0;
}
.ep__about {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}
.ep__about > div {
  flex: 1 1 0;
  min-width: 0;
}
.ep__still {
  flex: none;
  width: min(10rem, 40%);
  align-self: flex-start;
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
/* Episode rows respond to the width of the list, in units that follow the text size. */
.episodes {
  container: episodes / inline-size;
}
.season-nav {
  height: calc(var(--v-tabs-height) + 0.5rem);
  margin-bottom: 12px;
}
.season-nav :deep(.v-slide-group__content) {
  gap: 0.5rem;
  padding: 0.25rem;
}
.season-nav :deep(.season-nav__card) {
  flex: 0 0 auto;
  justify-content: start;
  min-width: 9rem;
  max-width: none;
  padding-inline: 1rem;
  border: 1px solid rgba(var(--v-theme-hairline), 0.78);
  border-radius: var(--th-radius);
  background: rgba(var(--v-theme-surface), 0.84);
  color: rgb(var(--v-theme-on-surface));
  letter-spacing: 0;
  text-align: start;
  transition: background-color var(--th-motion), border-color var(--th-motion), color var(--th-motion);
}
.season-nav :deep(.season-nav__card:hover) {
  border-color: rgb(var(--v-theme-on-surface-variant));
  background: rgb(var(--v-theme-surface-light));
}
.season-nav :deep(.season-nav__card.v-tab--selected) {
  border-color: rgb(var(--v-theme-primary));
}
.season-nav :deep(.season-nav__card .v-btn__content) {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  white-space: nowrap;
}
.season-nav :deep(.season-nav__card .v-btn__overlay),
.season-nav :deep(.season-nav__card::after) {
  display: none;
}
.season-nav :deep(.season-nav__card:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.season-nav__label {
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.25;
}
.season-nav__meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.season-nav__missing {
  padding: 0.05rem 0.4rem;
  border-radius: 5px;
  background: rgba(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-warning));
}
.season-nav :deep(.v-slide-group__prev),
.season-nav :deep(.v-slide-group__next) {
  min-width: 2.75rem;
  flex-basis: 2.75rem;
}
@container episodes (max-width: 22rem) {
  .season-nav__meta {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
  }
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
/* The trailer split button is a group, not a .v-btn, so give it the same height as its quiet siblings. */
.cta__row .v-btn-group.th-btn-quiet {
  height: auto;
  min-height: 2.75rem;
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
  flex: 1 1 8rem;
  min-width: 0;
  display: grid;
}
.ep__title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}
.ep__file {
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 10px;
  flex: 0 1 auto;
  min-width: 0;
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
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
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
    grid-template-columns: minmax(9rem, 12.5rem) minmax(0, 1fr);
    gap: 24px;
  }
  .hero__poster {
    max-width: 12.5rem;
  }
  .hero__title {
    font-size: clamp(2rem, calc(6vw * var(--th-text-scale)), 3rem);
  }
}
@media (max-width: 640px) {
  .hero {
    grid-template-columns: 1fr;
    align-items: start;
  }
  .hero__poster {
    width: min(58vw, 14rem);
    max-width: none;
  }
  .hero__info {
    width: 100%;
    padding-block: 0;
  }
  .hero__title {
    max-width: none;
  }
  .file__head {
    flex-wrap: wrap;
  }
}
@container episodes (max-width: 40rem) {
  .ep__row {
    flex-wrap: wrap;
    gap: 8px 12px;
  }
  .ep__line {
    align-items: flex-start;
  }
  .ep__meta {
    flex-basis: 100%;
    justify-content: flex-start;
  }
  .ep__actions {
    padding-top: 8px;
  }
  .ep__facts {
    padding-left: 16px;
  }
}
</style>
