<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiCheckBold, mdiCheckCircle, mdiCloudOffOutline } from '@mdi/js'
import type { TitleSummary } from '@theama/contracts'
import { useTilt } from '@/composables/useTilt'
import { useConnectionStore } from '@/stores/connection'
import PosterArt from './PosterArt.vue'
import TitleActionsMenu from './TitleActionsMenu.vue'

const props = withDefaults(defineProps<{ title: TitleSummary; tabindex?: number; caption?: string; inContinue?: boolean; selecting?: boolean; selected?: boolean }>(), {
  tabindex: 0,
  caption: undefined,
  inContinue: false,
  selecting: false,
  selected: false,
})
const emit = defineEmits<{ toggle: [key: string] }>()

/** While selecting, a click picks the card instead of opening it. */
function onLinkClick(e: Event): void {
  if (!props.selecting) return
  e.preventDefault()
  emit('toggle', props.title.key)
}
const { t } = useI18n()
const connection = useConnectionStore()

// Immersive mode only: the poster leans toward the pointer. Inert otherwise (see useTilt).
const art = ref<HTMLElement | null>(null)
const tilt = useTilt(art)

const offline = computed(() => props.title.availableCount === 0)
const partly = computed(() => props.title.availableCount > 0 && props.title.availableCount < props.title.fileCount)

/** One short line under the title: what is inside, in the viewer's words. */
const detail = computed(() => {
  const x = props.title
  if (x.kind === 'series') {
    const parts: string[] = []
    if (x.seasonCount > 0) parts.push(t('titles.seasons', x.seasonCount))
    parts.push(t('titles.episodes', x.episodeCount > 0 ? x.episodeCount : x.fileCount))
    if ((x.missingEpisodes ?? 0) > 0) parts.push(t('series.missingN', { n: x.missingEpisodes }))
    return parts.join(' · ')
  }
  if (x.kind === 'movie') return x.year ? String(x.year) : ''
  return ''
})

/** Looked up but not settled: the person is the only one who can say what it is. */
const needsId = computed(() => props.title.matchState === 'ambiguous' || props.title.matchState === 'unmatched')

const label = computed(() =>
  [props.title.title, props.caption ?? detail.value, offline.value ? t('files.offline') : '', partly.value ? t('titles.partial', { available: props.title.availableCount, total: props.title.fileCount }) : '', props.title.watchState === 'all' ? t('play.watched') : '', needsId.value ? t('match.notIdentified') : '']
    .filter(Boolean)
    .join(', '),
)
</script>

<template>
  <article class="card" :class="{ 'card--offline': offline, 'card--selected': selecting && selected }" data-poster-card>
    <router-link
      class="card__link"
      :to="{ name: 'title', query: { key: title.key } }"
      :data-title-key="title.key"
      :tabindex="tabindex ?? 0"
      :aria-label="label"
      :role="selecting ? 'checkbox' : undefined"
      :aria-checked="selecting ? selected : undefined"
      @click="onLinkClick"
      @keydown.space="onLinkClick"
      @pointermove="tilt.onPointerMove"
      @pointerleave="tilt.reset"
    >
      <div ref="art" class="card__art">
        <PosterArt
          :seed="title.key"
          :title="title.title"
          :year="title.kind === 'movie' ? title.year : null"
          :kind="title.kind"
          :image-url="connection.assetUrl(title.posterUrl)"
        />
        <span v-if="offline" class="card__badge card__badge--offline" :title="$t('files.offlineHint')">
          <svg viewBox="0 0 24 24" class="th-icon card__badge-icon" aria-hidden="true"><path :d="mdiCloudOffOutline" fill="currentColor" /></svg>
          {{ $t('files.offline') }}
        </span>
        <span v-else-if="partly" class="card__badge" :title="$t('titles.partlyHint')" :data-text="`${title.availableCount}/${title.fileCount}`" />
        <span v-if="title.watchState === 'all'" class="card__seen" :title="$t('play.watched')">
          <svg viewBox="0 0 24 24" class="th-icon card__seen-icon" aria-hidden="true"><path :d="mdiCheckCircle" fill="currentColor" /></svg>
        </span>
        <span v-if="needsId" class="card__badge card__badge--id" :title="$t('match.notIdentifiedHint')" data-text="?" />
        <span v-if="selecting" class="card__pick" :class="{ 'card__pick--on': selected }" aria-hidden="true">
          <svg v-if="selected" viewBox="0 0 24 24" class="th-icon card__pick-icon"><path :d="mdiCheckBold" fill="currentColor" /></svg>
        </span>
      </div>{{ ' ' }}
      <div class="card__meta" aria-hidden="true">
        <span class="card__title">{{ title.title }}</span>{{ ' ' }}<span v-if="caption ?? detail" class="card__detail th-muted">{{ caption ?? detail }}</span>
      </div>
    </router-link>
    <TitleActionsMenu v-if="!selecting" :title="title" :tabindex="tabindex === 0 ? 0 : -1" :in-continue="inContinue" />
  </article>
</template>

<style scoped>
.card {
  position: relative;
  display: block;
  min-width: 0;
  content-visibility: auto;
  contain-intrinsic-size: auto 20rem;
}
.card__link {
  display: block;
  color: inherit;
  text-decoration: none;
  border-radius: calc(var(--th-radius) + 2px);
  outline-offset: 4px;
}
.card__art {
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  border-radius: var(--th-radius);
  transition: transform var(--th-motion), box-shadow var(--th-motion);
}
.card:hover .card__art,
.card__link:focus-visible .card__art {
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
  /* Leave room for the actions button in the opposite corner, and truncate on narrow cards. */
  max-width: calc(100% - 3.25rem);
  overflow: hidden;
  white-space: nowrap;
  padding: 0.15em 0.6em;
  font-size: 0.7rem;
  border-radius: 999px;
  background: rgba(15, 14, 12, 0.82);
  color: #efe8da;
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.card__badge-icon {
  width: 1.1em;
  height: 1.1em;
}
.card__seen-icon {
  width: 1.5em;
  height: 1.5em;
}
.card__seen {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: grid;
  color: #8fd19e;
  background: rgba(15, 14, 12, 0.78);
  border-radius: 50%;
}
.card__pick {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  color: #fff;
  background: rgba(15, 14, 12, 0.7);
  border: 2px solid rgba(255, 255, 255, 0.75);
}
.card__pick--on {
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
}
.card__pick-icon {
  width: 1rem;
  height: 1rem;
}
.card--selected .card__art {
  box-shadow: 0 0 0 3px rgb(var(--v-theme-primary));
}
.card__badge[data-text]::before {
  content: attr(data-text);
}
.card__badge--id {
  left: auto;
  right: 8px;
  top: 3.25rem;
  min-width: 1.6em;
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
  min-width: 0;
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
  display: block;
  font-size: 0.8rem;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .card:hover .card__art,
  .card__link:focus-visible .card__art {
    transform: none;
  }
}
</style>

<!--
  Immersive 3D: the poster leans toward the pointer with a moving highlight. Not scoped, and anchored on
  data-poster-card, because this Vue version drops the selector after a leading :global() in scoped CSS.
  Everything hangs off html.th-immersive, so Standard mode is exactly the rules above. The card gives up
  content-visibility so a tilted poster is not cut off at the card's edge.
-->
<style>
.th-immersive [data-poster-card] {
  content-visibility: visible;
  perspective: 800px;
}
.th-immersive [data-poster-card] .card__art {
  transition:
    transform 140ms ease-out,
    box-shadow 200ms ease-out;
  will-change: transform;
}
.th-immersive [data-poster-card] .card__art::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at var(--glare-x, 50%) var(--glare-y, 0%), rgba(255, 255, 255, 0.28), transparent 55%);
  opacity: 0;
  transition: opacity 200ms ease-out;
  pointer-events: none;
}
.th-immersive [data-poster-card]:hover .card__art {
  transform: translateY(-6px) scale(1.04) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg));
  box-shadow:
    0 22px 40px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.08);
}
.th-immersive [data-poster-card]:hover .card__art::after {
  opacity: 1;
}
.th-immersive [data-poster-card] .card__link:focus-visible .card__art {
  transform: translateY(-6px) scale(1.04);
  box-shadow: 0 22px 40px rgba(0, 0, 0, 0.5);
}
</style>
