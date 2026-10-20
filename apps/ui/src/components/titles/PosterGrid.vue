<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TitleSummary } from '@theama/contracts'
import { columnsFromOffsets, nextGridIndex, type NavKey } from '@/utils/gridNav'
import PosterCard from './PosterCard.vue'

const props = defineProps<{ titles: TitleSummary[]; label: string; hasMore?: boolean; loading?: boolean; hideable?: boolean }>()
const emit = defineEmits<{ loadMore: []; hide: [title: TitleSummary] }>()

const root = ref<HTMLElement | null>(null)
const sentinel = ref<HTMLElement | null>(null)
/** Roving tabindex: the grid is a single Tab stop; arrow keys move within it. */
const active = ref(0)

const NAV_KEYS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

function cards(): HTMLElement[] {
  return root.value ? [...root.value.querySelectorAll<HTMLElement>('[data-title-key]')] : []
}

function indexOfEvent(target: EventTarget | null): number {
  if (!(target instanceof HTMLElement)) return -1
  const card = target.closest<HTMLElement>('[data-title-key]') ?? target.closest<HTMLElement>('.card')?.querySelector<HTMLElement>('[data-title-key]') ?? null
  return card ? cards().indexOf(card) : -1
}

function onKeydown(e: KeyboardEvent): void {
  if (!NAV_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return
  const all = cards()
  const from = indexOfEvent(e.target)
  if (from < 0) return
  const columns = columnsFromOffsets(all.map((c) => c.offsetTop))
  const to = nextGridIndex(e.key as NavKey, from, columns, all.length)
  if (to === from || to < 0) return // at an edge: let the page scroll as usual
  e.preventDefault()
  active.value = to
  all[to]!.focus()
}

function onFocusin(e: FocusEvent): void {
  const i = indexOfEvent(e.target)
  if (i >= 0) active.value = i
}

// Infinite scroll: ask for the next page when the end of the grid comes near the viewport.
let observer: IntersectionObserver | null = null
onMounted(() => {
  if (!sentinel.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && props.hasMore && !props.loading) emit('loadMore')
    },
    { rootMargin: '600px 0px' },
  )
  observer.observe(sentinel.value)
})
onBeforeUnmount(() => observer?.disconnect())

// If the list is replaced by a shorter one, keep the tab stop on a card that exists. After a page of
// results arrives and the sentinel is still on screen, ask again (IntersectionObserver only fires on change).
watch(
  () => props.titles.length,
  async (n) => {
    if (active.value >= n) active.value = Math.max(0, n - 1)
    await nextTick()
    if (props.hasMore && !props.loading && sentinel.value && sentinel.value.getBoundingClientRect().top < window.innerHeight + 600) emit('loadMore')
  },
)
</script>

<template>
  <div>
    <ul ref="root" class="grid" role="list" :aria-label="label" @keydown="onKeydown" @focusin="onFocusin">
      <li v-for="(t, i) in titles" :key="t.key" class="cell">
        <PosterCard :title="t" :tabindex="i === active ? 0 : -1" :hideable="hideable" @hide="emit('hide', t)" />
      </li>
    </ul>
    <div ref="sentinel" class="sentinel" aria-hidden="true" />
    <div v-if="loading" class="loading th-muted text-caption" role="status">{{ $t('common.loading') }}</div>
  </div>
</template>

<style scoped>
.grid {
  list-style: none;
  margin: 0;
  padding: 8px 4px 24px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 28px 20px;
}
@media (min-width: 1500px) {
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}
@media (max-width: 600px) {
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 20px 14px;
  }
}
.cell {
  min-width: 0;
}
.sentinel {
  height: 1px;
}
.loading {
  text-align: center;
  padding: 12px;
}
</style>
