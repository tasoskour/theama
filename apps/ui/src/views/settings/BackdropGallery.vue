<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import { mdiAutoFix } from '@mdi/js'
import { SCENE_IDS, type BackdropScene, type SceneId } from '@theama/contracts'
import { PROFILES } from '@/components/immersive/quality'
import type { PreviewOptions, PreviewRenderer } from '@/components/immersive/preview'
import { useImmersive } from '@/composables/useImmersive'
import { useSettingsStore } from '@/stores/settings'

const emit = defineEmits<{ choose: [patch: { backdropScene?: BackdropScene; backdropByGenre?: boolean; backdropByKind?: boolean }] }>()

const store = useSettingsStore()
const immersive = useImmersive()
const theme = useTheme()

/** Classic first (it is the default), then Automatic, then the rest in catalogue order. */
const cards = computed<{ id: BackdropScene; scene: SceneId | null }[]>(() => [
  { id: 'classic', scene: 'classic' },
  { id: 'auto', scene: null },
  ...SCENE_IDS.filter((s) => s !== 'classic').map((s) => ({ id: s, scene: s })),
])
const selected = computed(() => store.settings.backdropScene)
const auto = computed(() => selected.value === 'auto')

// --- thumbnails ----------------------------------------------------------------------------------
const canvases = new Map<SceneId, HTMLCanvasElement>()
const setCanvas = (id: SceneId, el: unknown): void => {
  if (el instanceof HTMLCanvasElement) canvases.set(id, el)
  else canvases.delete(id)
}

let preview: PreviewRenderer | null = null
let stopAnimation: (() => void) | null = null
let disposed = false
let paintToken = 0
const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function options(): PreviewOptions {
  return { dark: theme.current.value.dark, background: String(theme.current.value.colors.surface), profile: PROFILES[immersive.quality.value] }
}

/** One still per card, one per animation frame, so opening Settings never stalls on a burst of shader compiles. */
async function paintAll(): Promise<void> {
  if (!preview) return
  const mine = ++paintToken
  for (const card of cards.value) {
    if (!card.scene) continue
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const el = canvases.get(card.scene)
    if (disposed || mine !== paintToken || !preview || !el) return
    preview.still(el, card.scene, options())
  }
}

function animate(scene: SceneId | null): void {
  stopAnimation?.()
  stopAnimation = null
  if (!scene || !preview || reducedMotion) return
  const el = canvases.get(scene)
  if (el) stopAnimation = preview.animate(el, scene, options())
}
function settle(scene: SceneId | null): void {
  stopAnimation?.()
  stopAnimation = null
  const el = scene ? canvases.get(scene) : null
  if (scene && el && preview) preview.still(el, scene, options())
}

onMounted(async () => {
  // three.js is its own chunk; the gallery fetches it the same way the live backdrop does.
  const { createPreviewRenderer } = await import('@/components/immersive/preview')
  if (disposed) return
  try {
    preview = createPreviewRenderer()
  } catch {
    return // no graphics context: the cards still work, they just have no thumbnail
  }
  await nextTick()
  void paintAll()
})
watch([() => theme.current.value.dark, () => immersive.quality.value], () => void paintAll())
onBeforeUnmount(() => {
  disposed = true
  stopAnimation?.()
  preview?.dispose()
  preview = null
})

// --- choosing ------------------------------------------------------------------------------------
const buttons = ref<HTMLButtonElement[]>([])
const focusIndex = ref<number | null>(null)
const rovingIndex = computed(() => {
  const i = cards.value.findIndex((c) => c.id === selected.value)
  return i < 0 ? 0 : i
})
function onKeydown(e: KeyboardEvent, index: number): void {
  const last = cards.value.length - 1
  const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: last }[e.key]
  if (next === undefined) return
  e.preventDefault()
  const target = Math.min(last, Math.max(0, next))
  focusIndex.value = target
  buttons.value[target]?.focus()
}
function choose(id: BackdropScene): void {
  emit('choose', { backdropScene: id })
}
</script>

<template>
  <div class="gallery" data-test="backdrop-gallery">
    <span id="backdrop-title" class="label">{{ $t('settings.backdrop.title') }}</span>
    <p class="th-muted hint">{{ $t('settings.backdrop.hint') }}</p>

    <div class="cards" role="radiogroup" aria-labelledby="backdrop-title">
      <button
        v-for="(card, i) in cards"
        :key="card.id"
        :ref="(el) => { if (el) buttons[i] = el as HTMLButtonElement }"
        type="button"
        role="radio"
        class="card"
        :class="{ 'card--on': selected === card.id }"
        :aria-checked="selected === card.id"
        :tabindex="i === (focusIndex ?? rovingIndex) ? 0 : -1"
        :data-test="`backdrop-${card.id}`"
        @click="choose(card.id)"
        @keydown="onKeydown($event, i)"
        @pointerenter="animate(card.scene)"
        @pointerleave="settle(card.scene)"
        @focus="focusIndex = i; animate(card.scene)"
        @blur="settle(card.scene)"
      >
        <span class="thumb" aria-hidden="true">
          <canvas v-if="card.scene" :ref="(el) => setCanvas(card.scene!, el)" width="320" height="200" />
          <span v-else class="thumb__auto"><svg viewBox="0 0 24 24" width="40" height="40"><path :d="mdiAutoFix" fill="currentColor" /></svg></span>
        </span>
        <span class="name">
          {{ card.id === 'auto' ? $t('settings.backdrop.auto.name') : $t(`settings.backdrop.scenes.${card.id}.name`) }}
          <span v-if="card.id === 'classic'" class="badge">{{ $t('settings.backdrop.default') }}</span>
        </span>
        <span class="th-muted desc">{{ card.id === 'auto' ? $t('settings.backdrop.auto.hint') : $t(`settings.backdrop.scenes.${card.id}.hint`) }}</span>
      </button>
    </div>

    <div class="follow" data-test="backdrop-follow">
      <v-switch
        :model-value="store.settings.backdropByGenre"
        :label="$t('settings.backdrop.byGenre')"
        :disabled="!auto"
        color="primary"
        hide-details
        data-test="backdrop-by-genre"
        @update:model-value="(v: boolean | null) => emit('choose', { backdropByGenre: v === true })"
      />
      <p class="th-muted hint">{{ $t('settings.backdrop.byGenreHint') }}</p>
      <v-switch
        :model-value="store.settings.backdropByKind"
        :label="$t('settings.backdrop.byKind')"
        :disabled="!auto"
        color="primary"
        hide-details
        data-test="backdrop-by-kind"
        @update:model-value="(v: boolean | null) => emit('choose', { backdropByKind: v === true })"
      />
      <p class="th-muted hint">{{ $t('settings.backdrop.byKindHint') }}</p>
      <p v-if="!auto" class="th-muted hint">{{ $t('settings.backdrop.autoOnly') }}</p>
    </div>
  </div>
</template>

<style scoped>
.gallery {
  display: grid;
  gap: 8px;
}
.label {
  font-weight: 600;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
  margin: 8px 0 12px;
}
.card {
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 8px;
  text-align: start;
  color: inherit;
  font: inherit;
  cursor: pointer;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-theme-hairline));
  border-radius: var(--th-radius);
  transition: border-color var(--th-motion), box-shadow var(--th-motion);
}
.card:hover {
  border-color: rgba(var(--v-theme-primary), 0.6);
}
.card--on {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-primary));
}
.thumb {
  display: block;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: calc(var(--th-radius) - 2px);
  background: rgb(var(--v-theme-surface-variant));
}
.thumb canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.thumb__auto {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: rgb(var(--v-theme-primary));
  background: linear-gradient(135deg, rgba(var(--v-theme-primary), 0.18), rgba(var(--v-theme-primary), 0.04));
}
.name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.92rem;
}
.badge {
  padding: 1px 8px;
  font-size: 0.7rem;
  font-weight: 500;
  border-radius: 999px;
  border: 1px solid rgb(var(--v-theme-hairline));
}
.desc {
  font-size: 0.8rem;
  line-height: 1.3;
}
.follow {
  display: grid;
  gap: 4px;
}
</style>
