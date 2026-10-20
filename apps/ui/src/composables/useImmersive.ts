import { computed, ref, watch, watchEffect } from 'vue'
import type { GraphicsQuality } from '@theama/contracts'
import { PROFILES, type QualityProfile } from '@/components/immersive/quality'
import { useSettingsStore } from '@/stores/settings'

/** Why the immersive mode cannot run right now, when it cannot. */
export type ImmersiveBlock = 'webgl' | 'motion' | null

let webglProbe: boolean | undefined
/** One throwaway context, created once; the answer does not change while the app runs. */
function canUseWebgl(): boolean {
  if (webglProbe !== undefined) return webglProbe
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    webglProbe = gl !== null
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webglProbe = false
  }
  return webglProbe
}

const reducedMotion = ref(false)
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = query.matches
  query.addEventListener('change', (e) => (reducedMotion.value = e.matches))
}

/** Set for the rest of the session when the graphics card keeps failing; the saved setting is left alone. */
const sessionDisabled = ref(false)
/** Set when the animation could not keep up; lowers quality for this session only. */
const sessionQuality = ref<GraphicsQuality | null>(null)

/**
 * The single answer to "is the 3D layer running?". The saved setting says what the person wants;
 * this adds whether the computer can do it. Everything 3D reads this and nothing else.
 */
export function useImmersive() {
  const settings = useSettingsStore()

  const block = computed<ImmersiveBlock>(() => {
    if (!canUseWebgl() || sessionDisabled.value) return 'webgl'
    if (reducedMotion.value) return 'motion'
    return null
  })
  const wanted = computed(() => settings.settings.visualMode === 'immersive')
  const active = computed(() => wanted.value && block.value === null)
  const quality = computed<GraphicsQuality>(() => sessionQuality.value ?? settings.settings.graphicsQuality)
  const profile = computed<QualityProfile>(() => PROFILES[quality.value])

  return {
    wanted,
    active,
    block,
    quality,
    profile,
    /** Lower the quality for this session (the animation is struggling). */
    lowerQuality(to: GraphicsQuality): void {
      sessionQuality.value = to
    },
    /** Give up on 3D for this session (the graphics context keeps getting lost). */
    giveUp(): void {
      sessionDisabled.value = true
    },
  }
}

/** Mirrors the active state onto <html>, which the CSS keys every immersive style off. Call once, from the root. */
export function useImmersiveRoot(): void {
  const { active } = useImmersive()
  const settings = useSettingsStore()
  watchEffect(() => document.documentElement.classList.toggle('th-immersive', active.value))
  // Choosing a quality (or switching modes) is a fresh decision: it replaces whatever the session lowered it to.
  watch(
    () => [settings.settings.graphicsQuality, settings.settings.visualMode],
    () => (sessionQuality.value = null),
  )
}
