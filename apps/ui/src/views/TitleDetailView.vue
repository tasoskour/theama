<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { mdiArrowLeft, mdiCloudOffOutline, mdiPlay } from '@mdi/js'
import { TitleDetail, type MediaFile } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import FileFacts from '@/components/titles/FileFacts.vue'
import PosterArt from '@/components/titles/PosterArt.vue'
import { useConnectionStore } from '@/stores/connection'
import { episodeCode, formatBytes, formatDuration, resolutionLabel } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const connection = useConnectionStore()
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
      <section class="hero">
        <div class="hero__poster"><PosterArt :seed="summary.key" :title="summary.title" :year="summary.kind === 'movie' ? summary.year : null" :kind="summary.kind" /></div>
        <div class="hero__info">
          <p class="th-eyebrow">{{ kindLabel }}</p>
          <h1 ref="heading" tabindex="-1" class="th-display hero__title">{{ summary.title }}</h1>
          <ul class="chips" :aria-label="$t('detail.summary')">
            <li v-for="c in metaChips" :key="c"><v-chip size="small" label variant="tonal">{{ c }}</v-chip></li>
          </ul>

          <v-alert v-if="offline" type="warning" variant="tonal" density="compact" :icon="mdiCloudOffOutline" class="mt-4">{{ $t('files.offlineHint') }}</v-alert>

          <div class="cta">
            <!-- Honest placeholder: playback with external players is the next release; nothing pretends to play. -->
            <v-btn color="primary" size="large" :prepend-icon="mdiPlay" disabled aria-describedby="play-note">{{ $t('detail.play') }}</v-btn>
            <p id="play-note" class="th-muted text-caption">{{ $t('detail.playSoon') }}</p>
          </div>
        </div>
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
                <span class="ep__title">{{ f.episodeTitle || f.fileName }}</span>
                <span v-if="f.episodeTitle" class="ep__file th-muted">{{ f.fileName }}</span>
              </span>
              <span class="ep__meta">
                <v-chip v-if="f.state === 'source_offline'" size="x-small" color="warning" label variant="tonal">{{ $t('files.offline') }}</v-chip>
                <v-chip v-else-if="f.state === 'missing_unconfirmed'" size="x-small" color="error" label variant="tonal">{{ $t('files.missing') }}</v-chip>
                <v-chip v-if="f.probeError" size="x-small" color="error" label variant="outlined" :title="f.probeError">{{ $t('files.unreadable') }}</v-chip>
                <v-chip v-else-if="resolutionLabel(f.width, f.height)" size="x-small" label variant="outlined">{{ resolutionLabel(f.width, f.height) }}</v-chip>
                <span class="th-muted num">{{ formatDuration(f.durationMs, locale) }}</span>
              </span>
            </button>
            <div v-if="expanded === f.id" class="ep__facts"><FileFacts :file="f" /></div>
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
