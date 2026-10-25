<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TitleSummary } from '@theama/contracts'
import { nextGridIndex, type NavKey } from '@/utils/gridNav'
import PosterCard from './PosterCard.vue'

const props = defineProps<{ titles: TitleSummary[]; label: string; hasMore?: boolean; loading?: boolean }>()
const emit = defineEmits<{ loadMore: [] }>()
const root = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
const columns = ref(1)
const width = ref(180)
const gap = ref(18)
const rowHeight = ref(340)
const firstRow = ref(0)
const lastRow = ref(4)
const active = ref(0)
const ownsFocus = ref(false)
const rows = computed(() => Math.ceil(props.titles.length / columns.value))
const height = computed(() => Math.max(0, rows.value * rowHeight.value - gap.value) + 32)
const visible = computed(() => {
  const start = firstRow.value * columns.value
  const end = Math.min(props.titles.length, (lastRow.value + 1) * columns.value)
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i)
  // Keep an explicitly focused card mounted when the pointer scrolls away from it.
  if (ownsFocus.value && active.value < props.titles.length && !indices.includes(active.value)) indices.push(active.value)
  return indices.map(index => ({ index, title: props.titles[index]! }))
})
const NAV_KEYS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
let frame = 0
let resize: ResizeObserver | undefined
let fonts: MutationObserver | undefined
let observer: IntersectionObserver | undefined

function measure(): void {
  const el = root.value
  if (!el) return
  // Resolve rem-based sizing through the computed grid tracks, including text-size changes.
  const style = getComputedStyle(el)
  const tracks = style.gridTemplateColumns.split(' ').filter(Boolean)
  columns.value = Math.max(1, tracks.length)
  gap.value = parseFloat(style.columnGap) || 0
  width.value = Math.max(1, (el.clientWidth - 8 - gap.value * (columns.value - 1)) / columns.value)
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  rowHeight.value = width.value * 1.5 + 3.5 * rem + 12 + gap.value
  const top = el.getBoundingClientRect().top + 8
  const start = Math.max(0, Math.floor(-top / rowHeight.value) - 2)
  firstRow.value = Math.min(start, Math.max(0, rows.value - 1))
  lastRow.value = Math.min(rows.value - 1, Math.max(firstRow.value, Math.ceil((window.innerHeight - top) / rowHeight.value) + 1))
  if (!ownsFocus.value && (active.value < firstRow.value * columns.value || active.value >= (lastRow.value + 1) * columns.value)) {
    active.value = firstRow.value * columns.value
  }
}
function schedule(): void {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure() })
}
function indexOfEvent(target: EventTarget | null): number {
  const cell = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-grid-index]') : null
  return cell ? Number(cell.dataset.gridIndex) : -1
}
async function focusIndex(index: number, scroll = true): Promise<void> {
  active.value = index
  ownsFocus.value = true
  const el = root.value
  if (!el) return
  if (scroll) {
    const top = el.getBoundingClientRect().top + 8 + Math.floor(index / columns.value) * rowHeight.value
    if (top < 72 || top + rowHeight.value > window.innerHeight) window.scrollBy({ top: top - 80, behavior: 'instant' })
  }
  measure()
  await nextTick()
  el.querySelector<HTMLElement>(`[data-grid-index="${index}"] [data-title-key]`)?.focus({ preventScroll: true })
}
function onKeydown(e: KeyboardEvent): void {
  if (!NAV_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return
  const from = indexOfEvent(e.target)
  if (from < 0) return
  const to = nextGridIndex(e.key as NavKey, from, columns.value, props.titles.length)
  if (to === from || to < 0) return
  e.preventDefault()
  void focusIndex(to)
}
function onFocusin(e: FocusEvent): void {
  const index = indexOfEvent(e.target)
  if (index >= 0) { active.value = index; ownsFocus.value = true }
}
function onFocusout(e: FocusEvent): void {
  if (!(e.relatedTarget instanceof Node) || !root.value?.contains(e.relatedTarget)) ownsFocus.value = false
}
function restore(e: Event): void {
  const index = props.titles.findIndex(t => t.key === (e as CustomEvent<string>).detail)
  if (index >= 0) void focusIndex(index, false)
}
function checkMore(): void {
  if (props.hasMore && !props.loading && sentinel.value && sentinel.value.getBoundingClientRect().top < window.innerHeight + 600) emit('loadMore')
}
onMounted(() => {
  measure()
  resize = new ResizeObserver(schedule)
  if (root.value) resize.observe(root.value)
  fonts = new MutationObserver(schedule)
  fonts.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  document.addEventListener('theama:restore-title-focus', restore)
  observer = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) checkMore()
  }, { rootMargin: '600px 0px' })
  if (sentinel.value) observer.observe(sentinel.value)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  resize?.disconnect()
  fonts?.disconnect()
  observer?.disconnect()
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', schedule)
  document.removeEventListener('theama:restore-title-focus', restore)
})
watch(() => [props.titles.length, props.loading], async () => {
  active.value = Math.min(active.value, Math.max(0, props.titles.length - 1))
  measure()
  await nextTick()
  checkMore()
})
</script>

<template>
  <div class="poster-grid">
    <ul ref="root" class="grid" role="list" :aria-label="label" :style="{ height: `${height}px` }" @keydown="onKeydown" @focusin="onFocusin" @focusout="onFocusout">
      <li v-for="{ title, index } in visible" :key="title.key" class="cell" data-poster-cell :data-grid-index="index"
        :aria-posinset="index + 1" :aria-setsize="titles.length"
        :style="{ width: `${width}px`, left: `${4 + (index % columns) * (width + gap)}px`, top: `${8 + Math.floor(index / columns) * rowHeight}px` }">
        <PosterCard :title="title" :tabindex="index === active ? 0 : -1" />
      </li>
    </ul>
    <div ref="sentinel" class="sentinel" aria-hidden="true" />
    <div v-if="loading" class="loading th-muted text-caption" role="status">{{ $t('common.loading') }}</div>
  </div>
</template>

<style scoped>
.poster-grid { overflow-anchor: none; }
.grid {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 8px 4px 24px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--th-poster-min), 1fr));
  gap: var(--th-poster-gap);
  overflow-anchor: none;
}
.cell { position: absolute; min-width: 0; }
/* Reserve two title lines and one caption line, so virtual rows have a stable height. */
.cell :deep(.card__meta) { height: calc(3.5rem + 12px); }
.cell :deep(.card) { content-visibility: visible; }
.sentinel { height: 1px; }
.loading { text-align: center; padding: 12px; }
</style>

<!-- Immersive 3D: posters tip up out of the depth as they scroll into view. Needs scroll-driven animations. Not scoped: see PosterCard. -->
<style>
@supports (animation-timeline: view()) {
  .th-immersive [data-poster-cell] {
    animation: th-cell-rise linear both;
    animation-timeline: view();
    animation-range: entry 0% entry 45%;
  }
}
/* Depth only, no fading: text on a card must keep its full contrast wherever the card sits. */
@keyframes th-cell-rise {
  from {
    transform: perspective(900px) translateY(36px) translateZ(-90px) rotateX(14deg);
  }
  to {
    transform: perspective(900px) translateY(0) translateZ(0) rotateX(0deg);
  }
}
</style>
