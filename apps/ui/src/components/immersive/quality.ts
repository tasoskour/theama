import type { GraphicsQuality } from '@theama/contracts'

/** What one graphics-quality level asks of the graphics card. Pure data so it can be tested without WebGL. */
export interface QualityProfile {
  /** Upper bound for the canvas pixel ratio; the real ratio is min(devicePixelRatio, this). */
  maxPixelRatio: number
  /** Drifting dust points in the backdrop. */
  particles: number
  /** Blurred poster planes orbiting in depth. */
  posterPlanes: number
  /** Soft light shafts (a full-screen shader). */
  lightShafts: boolean
  /** Frame-rate ceiling; 0 means the display's own rate. */
  maxFps: number
  /** Full-screen shader effects that cost fill-rate (aurora, nebula, fog, grid). Off on Low. */
  richLayers: boolean
}

export const PROFILES: Record<GraphicsQuality, QualityProfile> = {
  low: { maxPixelRatio: 1, particles: 250, posterPlanes: 6, lightShafts: false, maxFps: 30, richLayers: false },
  medium: { maxPixelRatio: 1.5, particles: 900, posterPlanes: 10, lightShafts: true, maxFps: 60, richLayers: true },
  high: { maxPixelRatio: 2, particles: 2200, posterPlanes: 16, lightShafts: true, maxFps: 0, richLayers: true },
}

/** The full-screen effects a scene can layer behind the posters. */
export type BackdropFx = 'shafts' | 'aurora' | 'nebula' | 'fog' | 'grid' | 'flicker'

const RICH_FX: ReadonlySet<BackdropFx> = new Set(['aurora', 'nebula', 'fog', 'grid'])

/** Whether a profile can afford an effect: shafts follow their own switch, the heavy ones follow richLayers. */
export function fxAllowed(fx: BackdropFx, profile: QualityProfile): boolean {
  if (fx === 'shafts') return profile.lightShafts
  return RICH_FX.has(fx) ? profile.richLayers : true
}

const ORDER: readonly GraphicsQuality[] = ['low', 'medium', 'high']

export function pixelRatioFor(profile: QualityProfile, devicePixelRatio: number): number {
  return Math.max(1, Math.min(devicePixelRatio || 1, profile.maxPixelRatio))
}

/** The next level down, or null when already at the lowest. */
export function stepDown(quality: GraphicsQuality): GraphicsQuality | null {
  const i = ORDER.indexOf(quality)
  return i > 0 ? ORDER[i - 1]! : null
}

/** Frame time (ms) above which the animation is considered struggling. */
export const SLOW_FRAME_MS = 25
/** Frames sampled before judging. */
export const SAMPLE_FRAMES = 90

/** The frame time that counts as "too slow" for a profile: a deliberate frame-rate cap must not look like struggling. */
export function slowLimitFor(profile: QualityProfile): number {
  return profile.maxFps > 0 ? Math.max(SLOW_FRAME_MS, (1000 / profile.maxFps) * 1.5) : SLOW_FRAME_MS
}

/** True when a sample of frame durations shows sustained slowness (median over the limit, not one hitch). */
export function isStruggling(frameMs: readonly number[], limitMs: number = SLOW_FRAME_MS): boolean {
  if (frameMs.length < SAMPLE_FRAMES) return false
  const sorted = [...frameMs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]! > limitMs
}
