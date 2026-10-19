<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { mdiMovieOpenOutline, mdiTelevisionClassic, mdiVideoOutline } from '@mdi/js'
import type { TitleKind } from '@theama/contracts'
import { gradientFor, monogram, paletteFor, titleScale } from '@/utils/artwork'

const props = defineProps<{ seed: string; title: string; year?: number | null; kind: TitleKind; imageUrl?: string | null }>()

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
</script>

<template>
  <!-- Decorative: the accessible name lives on the card or page that contains it. -->
  <div class="art" :style="{ background, '--accent': palette.accent, '--scale': scale }" aria-hidden="true">
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
    <svg v-show="!loaded" class="art__icon" viewBox="0 0 24 24" width="18" height="18"><path :d="icon" fill="currentColor" /></svg>
    <div v-show="!loaded" class="art__mono th-display">{{ letters }}</div>
    <div v-show="!loaded" class="art__text">
      <span class="art__rule" />
      <span class="art__title th-display">{{ title }}</span>
      <span v-if="year" class="art__year">{{ year }}</span>
    </div>
  </div>
</template>

<style scoped>
.art {
  --accent: #d9b87a;
  --scale: 0.12;
  container-type: inline-size;
  position: relative;
  aspect-ratio: 2 / 3;
  width: 100%;
  overflow: hidden;
  border-radius: var(--th-radius);
  color: #f2ebdd;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 10cqw;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
}
/* Soft vignette and a faint film-grain-like pattern, for depth without any image. */
.art::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 80% at 20% 0%, rgba(255, 255, 255, 0.1), transparent 55%),
    linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent 55%);
  pointer-events: none;
}
.art__img {
  position: absolute;
  inset: 0;
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
