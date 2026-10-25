<script setup lang="ts">
import { ref, watch } from 'vue'
import { mdiChevronLeft, mdiChevronRight } from '@mdi/js'
import type { RouteLocationRaw } from 'vue-router'
import type { TitleSummary } from '@theama/contracts'
import PosterCard from './PosterCard.vue'

const props = defineProps<{ heading: string; titles: TitleSummary[]; seeAll?: RouteLocationRaw; total?: number; captions?: Record<string, string>; continueList?: boolean }>()

const scroller = ref<HTMLElement | null>(null)
const active = ref(0)

function cards(el: Element | null = scroller.value): HTMLElement[] {
  return el ? [...el.querySelectorAll<HTMLElement>('[data-title-key]')] : []
}

function indexOfEvent(target: EventTarget | null): number {
  const card = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-title-key]') : null
  return card ? cards().indexOf(card) : -1
}

/** The card at the same position in the rail above/below, so Up/Down feel like moving between rows. */
function siblingRailCard(direction: 1 | -1, index: number): HTMLElement | null {
  const rails = [...document.querySelectorAll<HTMLElement>('[data-rail]')]
  const me = rails.findIndex((r) => r.contains(scroller.value))
  const other = rails[me + direction]
  const list = cards(other ?? null)
  return list.length ? list[Math.min(index, list.length - 1)]! : null
}

function onKeydown(e: KeyboardEvent): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return
  const from = indexOfEvent(e.target)
  if (from < 0) return
  const all = cards()
  let target: HTMLElement | null = null
  switch (e.key) {
    case 'ArrowRight':
      target = all[Math.min(all.length - 1, from + 1)] ?? null
      break
    case 'ArrowLeft':
      target = all[Math.max(0, from - 1)] ?? null
      break
    case 'Home':
      target = all[0] ?? null
      break
    case 'End':
      target = all[all.length - 1] ?? null
      break
    case 'ArrowDown':
      target = siblingRailCard(1, from)
      break
    case 'ArrowUp':
      target = siblingRailCard(-1, from)
      break
    default:
      return
  }
  if (target && target !== all[from]) {
    e.preventDefault()
    target.focus()
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
    e.preventDefault() // never scroll the page sideways
  }
}

function onFocusin(e: FocusEvent): void {
  const i = indexOfEvent(e.target)
  if (i >= 0) active.value = i
}

function page(direction: 1 | -1): void {
  const el = scroller.value
  if (!el) return
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior })
}

watch(
  () => props.titles.length,
  (n) => {
    if (active.value >= n) active.value = Math.max(0, n - 1)
  },
)
</script>

<template>
  <section class="rail" data-rail :aria-label="heading">
    <header class="rail__head">
      <h2 class="th-display rail__title">{{ heading }}</h2>
      <router-link v-if="seeAll" :to="seeAll" class="rail__all">
        {{ $t('titles.seeAll') }}<span v-if="total" class="th-muted"> ({{ total }})</span>
      </router-link>
    </header>
    <div class="rail__frame">
      <button type="button" class="rail__nav rail__nav--prev" :aria-label="$t('titles.scrollLeft')" tabindex="-1" @click="page(-1)">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path :d="mdiChevronLeft" fill="currentColor" /></svg>
      </button>
      <ul ref="scroller" class="rail__list" role="list" @keydown="onKeydown" @focusin="onFocusin">
        <li v-for="(t, i) in titles" :key="t.key" class="rail__item">
          <PosterCard :title="t" :tabindex="i === active ? 0 : -1" :caption="captions?.[t.key]" :in-continue="continueList" />
        </li>
      </ul>
      <button type="button" class="rail__nav rail__nav--next" :aria-label="$t('titles.scrollRight')" tabindex="-1" @click="page(1)">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path :d="mdiChevronRight" fill="currentColor" /></svg>
      </button>
    </div>
  </section>
</template>

<style scoped>
.rail {
  margin-bottom: 32px;
}
.rail__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 16px;
  margin-bottom: 12px;
}
.rail__title {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 1.35rem;
  margin: 0;
}
.rail__all {
  color: rgb(var(--v-theme-primary));
  font-size: 0.9rem;
  text-decoration: none;
}
.rail__all:hover {
  text-decoration: underline;
}
.rail__frame {
  position: relative;
}
.rail__list {
  list-style: none;
  margin: 0;
  /* Room above and below so the lifted card and its focus ring are never clipped by the scroller. */
  padding: 10px 4px 14px;
  display: flex;
  gap: 18px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scroll-padding-inline: 4px;
  scrollbar-width: thin;
}
.rail__item {
  flex: 0 0 clamp(8rem, 13vw, 13rem);
  min-width: 0;
  scroll-snap-align: start;
}
.rail__nav {
  position: absolute;
  /* Centre of the poster: half of its 2:3 height, whatever the text size or caption length. */
  top: calc(clamp(8rem, 13vw, 13rem) * 0.75 + 10px - 2rem);
  z-index: 2;
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 4rem;
  border: 0;
  border-radius: 8px;
  background: rgba(15, 14, 12, 0.78);
  color: #efe8da;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--th-motion);
}
.rail__nav--prev {
  left: -6px;
}
.rail__nav--next {
  right: -6px;
}
.rail__frame:hover .rail__nav,
.rail__frame:focus-within .rail__nav {
  opacity: 1;
}
@media (hover: none), (max-width: 600px) {
  .rail__nav {
    display: none; /* touch: swipe */
  }
}
</style>

<!--
  Immersive 3D: the shelf curves away from the middle of the visible row. Each item is driven by its own
  position inside the scrolling list (scroll-driven animation), so there is no script and no layout cost.
  Not scoped: see PosterCard.
-->
<style>
@supports (animation-timeline: view()) {
  .th-immersive [data-rail] .rail__list {
    perspective: 1000px;
  }
  .th-immersive [data-rail] .rail__item {
    animation: th-rail-curve linear both;
    animation-timeline: view(inline);
  }
}
/* Depth only, no fading: text on a card must keep its full contrast wherever the card sits. */
@keyframes th-rail-curve {
  0% {
    transform: translateZ(-90px) rotateY(16deg);
  }
  30%,
  70% {
    transform: translateZ(0) rotateY(0deg);
  }
  100% {
    transform: translateZ(-90px) rotateY(-16deg);
  }
}
</style>
