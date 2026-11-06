<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { mdiMovieOpenOutline, mdiTelevisionClassic, mdiVideoOutline } from '@mdi/js'
import type { TitleKind } from '@theama/contracts'
import { gradientFor, monogram, paletteFor, titleScale } from '@/utils/artwork'
import { fillPercent } from '@/utils/posterProgress'

/**
 * `progress` (0–1) is for a movie still downloading: the left part of the poster, as wide as the download is
 * complete, is shown in full colour and the rest is dimmed. Leave it out for a whole poster.
 */
const props = defineProps<{ seed: string; title: string; year?: number | null; kind: TitleKind; imageUrl?: string | null; progress?: number | null }>()

/** Real artwork replaces the generated poster once it has loaded; until then (or if it fails) the generated one stays. */
const loaded = ref(false)
const failed = ref(false)
watch(
  () => props.imageUrl,
  () => {
    loaded.value = false
    failed.value = false
  },
)

const palette = computed(() => paletteFor(props.seed))
const background = computed(() => gradientFor(props.seed))
const icon = computed(() => ({ movie: mdiMovieOpenOutline, series: mdiTelevisionClassic, video: mdiVideoOutline })[props.kind])
const letters = computed(() => monogram(props.title))
const scale = computed(() => titleScale(props.title))
const filling = computed(() => props.progress != null && props.progress < 1)
const fill = computed(() => fillPercent(props.progress ?? 1))
/** Dimmed copy underneath, full-colour copy on top; a whole poster has just the one. */
const layers = computed<('dim' | 'full')[]>(() => (filling.value ? ['dim', 'full'] : ['full']))
</script>

<template>
  <!-- Decorative: the accessible name lives on the card or page that contains it. -->
  <div class="art" :class="{ 'art--filling': filling }" :style="{ background, '--accent': palette.accent, '--scale': scale, '--fill': fill }" aria-hidden="true">
    <div v-for="layer in layers" :key="layer" class="art__layer" :class="`art__layer--${layer}`" :style="{ background }">
      <img
        v-if="imageUrl && !failed"
        class="art__img"
        :class="{ 'art__img--ready': loaded }"
        :src="imageUrl"
        alt=""
        loading="lazy"
        decoding="async"
        @load="loaded = true"
        @error="failed = true"
      />
      <svg v-show="!loaded" class="art__icon" viewBox="0 0 24 24"><path :d="icon" fill="currentColor" /></svg>
      <div v-show="!loaded" class="art__mono th-display" :data-text="letters" />
      <div v-show="!loaded" class="art__text">
        <span class="art__rule" />
        <span class="art__title th-display" :data-text="title" />
        <span v-if="year" class="art__year" :data-text="String(year)" />
      </div>
    </div>
    <span v-if="filling" class="art__edge" />
  </div>
</template>

<style scoped>
.art {
  --accent: #d9b87a;
  --scale: 0.12;
  box-sizing: border-box;
  container-type: inline-size;
  position: relative;
  aspect-ratio: 2 / 3;
  display: flex;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  border-radius: var(--th-radius);
  color: #f2ebdd;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
}
/* Soft vignette and a faint film-grain-like pattern, for depth without any image. */
.art__layer::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 80% at 20% 0%, rgba(255, 255, 255, 0.1), transparent 55%),
    linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent 55%);
  pointer-events: none;
}
/* Each layer is a whole poster; a download in progress stacks two of them (see `progress`). */
.art__layer {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 10%;
}
.art--filling .art__layer--dim {
  filter: grayscale(0.85) brightness(0.55);
}
.art--filling .art__layer--full {
  clip-path: inset(0 calc(100% - var(--fill)) 0 0);
  transition: clip-path 600ms linear;
}
.art__edge {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--fill);
  width: 1px;
  background: rgba(255, 255, 255, 0.35);
  transition: left 600ms linear;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .art--filling .art__layer--full,
  .art__edge {
    transition: none;
  }
}
.art__img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--th-motion);
}
.art__img--ready {
  opacity: 1;
}
.art__icon {
  position: absolute;
  top: 8cqw;
  right: 8cqw;
  width: 12cqw;
  height: 12cqw;
  opacity: 0.55;
  color: var(--accent);
}
.art__mono {
  position: absolute;
  top: 12cqw;
  left: 10cqw;
  font-size: 34cqw;
  line-height: 1;
  color: var(--accent);
  opacity: 0.22;
  letter-spacing: -0.02em;
}
.art__text {
  position: relative;
  display: grid;
  gap: 4cqw;
}
/* The words are painted from data-text, so they are not part of the page's text (the card's own label is). */
.art__mono::before,
.art__title::before,
.art__year::before {
  content: attr(data-text);
}
.art__rule {
  width: 14cqw;
  height: 2px;
  background: var(--accent);
}
.art__title {
  font-size: calc(var(--scale) * 100cqw);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.art__year {
  font-size: 7cqw;
  letter-spacing: 0.18em;
  color: var(--accent);
}
</style>
