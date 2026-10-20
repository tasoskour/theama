<script setup lang="ts">
import { mdiChevronLeft, mdiChevronRight } from '@mdi/js'
import { ref } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { CollectionSummary } from '@theama/contracts'
import { moveBetweenCards } from '@/utils/gridNav'
import CollectionCard from './CollectionCard.vue'

defineProps<{ heading: string; collections: CollectionSummary[]; seeAll?: RouteLocationRaw }>()

const scroller = ref<HTMLElement | null>(null)
function page(direction: 1 | -1): void {
  const el = scroller.value
  if (!el) return
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior })
}
</script>

<template>
  <section class="rail" :aria-label="heading" data-test="collection-rail">
    <header class="rail__head">
      <h2 class="th-display rail__title">{{ heading }}</h2>
      <router-link v-if="seeAll" :to="seeAll" class="rail__all">{{ $t('titles.seeAll') }}</router-link>
    </header>
    <div class="rail__frame">
      <button type="button" class="rail__nav rail__nav--prev" :aria-label="$t('titles.scrollLeft')" tabindex="-1" @click="page(-1)">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path :d="mdiChevronLeft" fill="currentColor" /></svg>
      </button>
      <ul ref="scroller" class="rail__list" role="list" @keydown="moveBetweenCards($event, '[data-collection-id]')">
        <li v-for="c in collections" :key="c.id" class="rail__item"><CollectionCard :collection="c" /></li>
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
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.rail__title {
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
  padding: 10px 4px 14px;
  display: flex;
  gap: 18px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}
.rail__item {
  flex: 0 0 clamp(130px, 13vw, 180px);
  scroll-snap-align: start;
}
.rail__nav {
  position: absolute;
  top: 38%;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 40px;
  height: 64px;
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
@media (hover: none) {
  .rail__nav {
    display: none;
  }
}
</style>
