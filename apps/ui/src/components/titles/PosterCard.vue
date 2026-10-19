<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiCloudOffOutline } from '@mdi/js'
import type { TitleSummary } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'
import PosterArt from './PosterArt.vue'

const props = defineProps<{ title: TitleSummary; tabindex?: number }>()
const { t } = useI18n()
const connection = useConnectionStore()

const offline = computed(() => props.title.availableCount === 0)
const partly = computed(() => props.title.availableCount > 0 && props.title.availableCount < props.title.fileCount)

/** One short line under the title: what is inside, in the viewer's words. */
const detail = computed(() => {
  const x = props.title
  if (x.kind === 'series') {
    const parts: string[] = []
    if (x.seasonCount > 0) parts.push(t('titles.seasons', x.seasonCount))
    parts.push(t('titles.episodes', x.episodeCount > 0 ? x.episodeCount : x.fileCount))
    return parts.join(' · ')
  }
  if (x.kind === 'movie') return x.year ? String(x.year) : ''
  return ''
})

/** Looked up but not settled: the person is the only one who can say what it is. */
const needsId = computed(() => props.title.matchState === 'ambiguous' || props.title.matchState === 'unmatched')

const label = computed(() =>
  [props.title.title, detail.value, offline.value ? t('files.offline') : '', needsId.value ? t('match.notIdentified') : ''].filter(Boolean).join(', '),
)
</script>

<template>
  <router-link
    class="card"
    :class="{ 'card--offline': offline }"
    :to="{ name: 'title', query: { key: title.key } }"
    :data-title-key="title.key"
    :tabindex="tabindex ?? 0"
    :aria-label="label"
  >
    <div class="card__art">
      <PosterArt
        :seed="title.key"
        :title="title.title"
        :year="title.kind === 'movie' ? title.year : null"
        :kind="title.kind"
        :image-url="connection.assetUrl(title.posterUrl)"
      />
      <span v-if="offline" class="card__badge card__badge--offline" :title="$t('files.offlineHint')">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path :d="mdiCloudOffOutline" fill="currentColor" /></svg>
        {{ $t('files.offline') }}
      </span>
      <span v-else-if="partly" class="card__badge" :title="$t('titles.partlyHint')">{{ title.availableCount }}/{{ title.fileCount }}</span>
      <span v-if="needsId" class="card__badge card__badge--id" :title="$t('match.notIdentifiedHint')">?</span>
    </div>
    <div class="card__meta" aria-hidden="true">
      <div class="card__title">{{ title.title }}</div>
      <div v-if="detail" class="card__detail th-muted">{{ detail }}</div>
    </div>
  </router-link>
</template>

<style scoped>
.card {
  display: block;
  color: inherit;
  text-decoration: none;
  border-radius: calc(var(--th-radius) + 2px);
  outline-offset: 4px;
  /* Off-screen cards in a long grid are not laid out or painted until they scroll near. */
  content-visibility: auto;
  contain-intrinsic-size: auto 330px;
}
.card__art {
  position: relative;
  transition: transform var(--th-motion), box-shadow var(--th-motion);
}
.card:hover .card__art,
.card:focus-visible .card__art {
  transform: translateY(-4px) scale(1.02);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
}
.card--offline .card__art {
  filter: grayscale(0.85) brightness(0.7);
}
.card__badge {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 0.7rem;
  border-radius: 999px;
  background: rgba(15, 14, 12, 0.82);
  color: #efe8da;
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.card__badge--id {
  left: auto;
  right: 8px;
  min-width: 22px;
  justify-content: center;
  font-weight: 700;
  color: #dca94e;
  border-color: rgba(220, 169, 78, 0.5);
}
.card__badge--offline {
  color: #dca94e;
  border-color: rgba(220, 169, 78, 0.5);
}
.card__meta {
  padding: 10px 2px 0;
}
.card__title {
  font-weight: 600;
  font-size: 0.92rem;
  line-height: 1.25;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}
.card__detail {
  font-size: 0.8rem;
  margin-top: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .card:hover .card__art,
  .card:focus-visible .card__art {
    transform: none;
  }
}
</style>
