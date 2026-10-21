<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from 'vuetify'
import type { SceneId, TitleKind } from '@theama/contracts'
import { useImmersive } from '@/composables/useImmersive'
import { sceneHint } from '@/composables/useSceneHint'
import { useTitles } from '@/composables/useTitles'
import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'
import { paletteFor } from '@/utils/artwork'
import { stepDown } from './quality'
import { kindFromRoute, resolveScene } from './resolve'
import type { ImmersiveScene, PosterSource } from './scene'

/** Gives up on 3D for the session after the graphics context has been lost this many times. */
const MAX_CONTEXT_LOSSES = 3
/** Enough posters for the High profile; the scene reuses them when it shows fewer or more planes. */
const POSTER_POOL = 16

const canvas = ref<HTMLCanvasElement | null>(null)
const immersive = useImmersive()
const connection = useConnectionStore()
const settings = useSettingsStore()
const route = useRoute()
const theme = useTheme()

/** What the page says about itself, with the kind its route implies when the page says nothing. */
const context = computed(() => ({ ...sceneHint.value, kind: sceneHint.value.kind ?? kindFromRoute(route.name) }))
const sceneId = computed<SceneId>(() =>
  resolveScene(context.value, {
    backdropScene: settings.settings.backdropScene,
    backdropByGenre: settings.settings.backdropByGenre,
    backdropByKind: settings.settings.backdropByKind,
  }),
)

/** The movie, series and video scenes float posters of that kind; every other scene mixes (or, on Automatic, follows the page). */
const KIND_OF_SCENE: Partial<Record<SceneId, TitleKind>> = { movie: 'movie', series: 'series', video: 'video' }
const posterKind = computed<TitleKind | undefined>(() => KIND_OF_SCENE[sceneId.value] ?? (settings.settings.backdropScene === 'auto' ? (context.value.kind ?? undefined) : undefined))
const recent = useTitles({ kind: () => posterKind.value, sort: 'added', limit: POSTER_POOL })
watch(posterKind, () => void recent.reload())

let scene: ImmersiveScene | null = null
let unmounted = false

const posters = computed<PosterSource[]>(() =>
  recent.items.value.map((t) => {
    const p = paletteFor(t.key)
    return { seed: t.key, url: connection.assetUrl(t.posterUrl), from: p.from, to: p.to }
  }),
)

/** Each tab has its own tint; a title page takes the tint of its own generated poster. */
const accent = computed(() => paletteFor(route.name === 'title' ? String(route.query.key ?? 'title') : String(route.name ?? 'home')).accent)
const dark = computed(() => theme.current.value.dark)

function onPointer(e: PointerEvent): void {
  scene?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1))
}
function onScroll(): void {
  scene?.setScroll(window.scrollY)
}
function onResize(): void {
  scene?.resize()
}

onMounted(async () => {
  const el = canvas.value
  if (!el) return
  // three.js is its own chunk: Standard mode never downloads it.
  const { createScene } = await import('./scene')
  if (unmounted) return
  try {
    scene = createScene({
      canvas: el,
      profile: immersive.profile.value,
      dark: dark.value,
      scene: sceneId.value,
      accent: accent.value,
      onStruggle: () => {
        const lower = stepDown(immersive.quality.value)
        if (lower) immersive.lowerQuality(lower)
      },
      onContextLost: (count) => {
        if (count >= MAX_CONTEXT_LOSSES) immersive.giveUp()
      },
    })
  } catch {
    // The graphics card refused after all; carry on with the standard interface.
    immersive.giveUp()
    return
  }
  scene.setPosters(posters.value)
  window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)
  onScroll()
})

watch(() => immersive.profile.value, (p) => scene?.setProfile(p))
watch(dark, (d) => scene?.setDark(d))
watch(sceneId, (id) => scene?.setScene(id))
watch(accent, (a) => scene?.setAccent(a))
watch(posters, (p) => scene?.setPosters(p))
watch(
  () => route.matched[0]?.path ?? route.path,
  () => scene?.dolly(),
)

onBeforeUnmount(() => {
  unmounted = true
  window.removeEventListener('pointermove', onPointer)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  scene?.dispose()
  scene = null
})
</script>

<template>
  <canvas ref="canvas" class="backdrop" aria-hidden="true" data-test="immersive-backdrop" :data-scene="sceneId" />
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  animation: backdrop-in 600ms var(--th-ease) both;
}
@keyframes backdrop-in {
  from {
    opacity: 0;
  }
}
</style>
