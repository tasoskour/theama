import type { SceneId } from '@theama/contracts'
import type { BackdropFx } from './quality'

/**
 * The scene catalogue: every backdrop is a description assembled from a few reusable pieces
 * (particles, full-screen effects, floating posters), so a new scene is data, not new drawing code.
 * Plain data with no three.js in it, so the catalogue can be tested and listed without loading WebGL.
 */

/** How a particle moves. */
export type ParticleMode = 'drift' | 'rise' | 'fall' | 'wander' | 'rain' | 'bokeh'
/** How a particle is drawn. */
export type ParticleShape = 'dot' | 'streak' | 'bokeh' | 'confetti' | 'petal' | 'bubble'
/** How the floating posters are arranged. `field`: drifting at random depths. `columns`: lanes moving up and down. `ring`: a slow carousel. */
export type PosterLayout = 'field' | 'columns' | 'ring'

export interface ParticleSpec {
  mode: ParticleMode
  shape: ParticleShape
  /** Share of the quality profile's particle budget. */
  count: number
  /** Upper limit on how many are drawn, for big shapes (bokeh, bubbles) that must not get denser on a stronger profile. */
  cap?: number
  size: number
  /** Opacity on a dark and on a light page. */
  alpha: number
  alphaLight: number
  /** Time multiplier for the motion. */
  speed: number
  /** 0 steady, 1 fully twinkling. */
  twinkle: number
}

export interface FxSpec {
  fx: BackdropFx
  /** Multiplier on the effect's own base opacity. */
  strength: number
}

export interface PosterSpec {
  layout: PosterLayout
  /** Share of the quality profile's poster budget. */
  count: number
  /** Opacity on a dark page; a light page gets half. */
  opacity: number
  /** Mip bias, which is the blur: higher is softer. */
  blur: number
  /** How much of the accent colour is mixed into the artwork (a sepia or noir wash). */
  tint: number
  speed: number
}

export interface SceneTheme {
  id: SceneId
  /** The scene is tinted by the route (as the original backdrop always was) instead of by its own colours. */
  followsRoute: boolean
  accent: string
  accent2: string
  accent3: string
  particles: readonly ParticleSpec[]
  fx: readonly FxSpec[]
  posters: PosterSpec
}

const dust = (over: Partial<ParticleSpec> = {}): ParticleSpec => ({ mode: 'drift', shape: 'dot', count: 1, size: 5, alpha: 0.9, alphaLight: 0.5, speed: 1, twinkle: 1, ...over })
const posters = (over: Partial<PosterSpec> = {}): PosterSpec => ({ layout: 'field', count: 1, opacity: 0.36, blur: 1.8, tint: 0.18, speed: 1, ...over })

export const THEMES: Record<SceneId, SceneTheme> = {
  // The default backdrop: dust, soft light shafts, and gently softened posters drifting at depth.
  classic: {
    id: 'classic',
    followsRoute: true,
    accent: '#D9B87A',
    accent2: '#D9B87A',
    accent3: '#FFFFFF',
    particles: [dust()],
    fx: [{ fx: 'shafts', strength: 1 }],
    posters: posters(),
  },

  // --- by kind of title ---------------------------------------------------------------------
  movie: {
    id: 'movie',
    followsRoute: false,
    accent: '#E8C27A',
    accent2: '#FFF1D0',
    accent3: '#FFFFFF',
    particles: [dust({ count: 0.9, size: 4.5, alpha: 0.8, alphaLight: 0.45, speed: 0.8 })],
    fx: [{ fx: 'shafts', strength: 1.6 }],
    posters: posters({ layout: 'ring', opacity: 0.4, speed: 1 }),
  },
  series: {
    id: 'series',
    followsRoute: false,
    accent: '#7FB3FF',
    accent2: '#B49CFF',
    accent3: '#FFFFFF',
    particles: [dust({ count: 0.6, size: 3.5, alpha: 0.6, alphaLight: 0.4, speed: 0.7 })],
    fx: [{ fx: 'fog', strength: 1.6 }],
    posters: posters({ layout: 'columns', opacity: 0.5, blur: 1.4, tint: 0.12, speed: 1 }),
  },
  video: {
    id: 'video',
    followsRoute: false,
    accent: '#FFB070',
    accent2: '#FF8FA3',
    accent3: '#FFE0B0',
    particles: [dust({ mode: 'bokeh', shape: 'bokeh', count: 0.05, cap: 36, size: 28, alpha: 0.2, alphaLight: 0.16, speed: 1, twinkle: 0.2 })],
    fx: [],
    posters: posters({ opacity: 0.32, blur: 2.4, tint: 0.14, speed: 0.7 }),
  },

  // --- by genre -----------------------------------------------------------------------------
  action: {
    id: 'action',
    followsRoute: false,
    accent: '#FF6A2B',
    accent2: '#FFC44D',
    accent3: '#FFFFFF',
    particles: [dust({ mode: 'rise', size: 5, count: 1.1, alpha: 0.95, alphaLight: 0.6, speed: 1.6, twinkle: 0.6 })],
    fx: [{ fx: 'shafts', strength: 0.9 }],
    posters: posters({ opacity: 0.34, speed: 1.8, tint: 0.22 }),
  },
  animation: {
    id: 'animation',
    followsRoute: false,
    accent: '#FF5FA2',
    accent2: '#4DD6FF',
    accent3: '#FFD84D',
    particles: [dust({ mode: 'bokeh', shape: 'bokeh', count: 0.09, cap: 64, size: 24, alpha: 0.3, alphaLight: 0.22, speed: 1.2, twinkle: 0.3 })],
    fx: [],
    posters: posters({ opacity: 0.36, blur: 1.6, tint: 0.1 }),
  },
  comedy: {
    id: 'comedy',
    followsRoute: false,
    accent: '#FFC933',
    accent2: '#4DD6C4',
    accent3: '#FF6FA0',
    particles: [dust({ mode: 'fall', shape: 'confetti', count: 0.5, cap: 520, size: 7, alpha: 0.9, alphaLight: 0.75, speed: 0.9, twinkle: 0 })],
    fx: [],
    posters: posters({ opacity: 0.34, tint: 0.08 }),
  },
  crime: {
    id: 'crime',
    followsRoute: false,
    accent: '#5B8CFF',
    accent2: '#FF3D8A',
    accent3: '#BFD0FF',
    particles: [dust({ mode: 'rain', shape: 'streak', count: 0.5, size: 46, alpha: 0.5, alphaLight: 0.4, speed: 2.4, twinkle: 0 })],
    fx: [{ fx: 'fog', strength: 1.1 }],
    posters: posters({ opacity: 0.26, blur: 2.4, tint: 0.32, speed: 0.7 }),
  },
  documentary: {
    id: 'documentary',
    followsRoute: false,
    accent: '#B9AF9C',
    accent2: '#D9B87A',
    accent3: '#FFFFFF',
    particles: [dust({ count: 0.7, size: 3.5, alpha: 0.6, alphaLight: 0.4, speed: 0.5 })],
    fx: [],
    posters: posters({ opacity: 0.33, blur: 2, tint: 0.05, speed: 0.5 }),
  },
  drama: {
    id: 'drama',
    followsRoute: false,
    accent: '#E0A04E',
    accent2: '#8A3B2B',
    accent3: '#FFE2B0',
    particles: [dust({ count: 0.4, size: 4, alpha: 0.6, alphaLight: 0.4, speed: 0.6 })],
    fx: [{ fx: 'shafts', strength: 1.8 }],
    posters: posters({ opacity: 0.32, tint: 0.24, speed: 0.7 }),
  },
  family: {
    id: 'family',
    followsRoute: false,
    accent: '#7CD4FF',
    accent2: '#FFD27C',
    accent3: '#FF9FD0',
    particles: [dust({ mode: 'bokeh', shape: 'bubble', count: 0.07, cap: 44, size: 22, alpha: 0.35, alphaLight: 0.3, speed: 0.9, twinkle: 0.1 })],
    fx: [],
    posters: posters({ opacity: 0.34, blur: 1.6, tint: 0.08, speed: 0.8 }),
  },
  fantasy: {
    id: 'fantasy',
    followsRoute: false,
    accent: '#9CFFCB',
    accent2: '#B48CFF',
    accent3: '#FFF2A8',
    particles: [dust({ mode: 'wander', count: 0.6, size: 6, alpha: 1, alphaLight: 0.7, speed: 1, twinkle: 1 })],
    fx: [{ fx: 'aurora', strength: 1 }],
    posters: posters({ opacity: 0.3, tint: 0.2, speed: 0.8 }),
  },
  horror: {
    id: 'horror',
    followsRoute: false,
    accent: '#C22A2A',
    accent2: '#5A0F0F',
    accent3: '#FF8A7A',
    particles: [dust({ mode: 'fall', shape: 'dot', count: 0.5, size: 3, alpha: 0.5, alphaLight: 0.4, speed: 0.4, twinkle: 0.3 })],
    fx: [
      { fx: 'fog', strength: 1.3 },
      { fx: 'flicker', strength: 1 },
    ],
    posters: posters({ opacity: 0.22, blur: 2.6, tint: 0.4, speed: 0.4 }),
  },
  romance: {
    id: 'romance',
    followsRoute: false,
    accent: '#FF8FB1',
    accent2: '#FFD1DC',
    accent3: '#FFB347',
    particles: [
      dust({ mode: 'fall', shape: 'petal', count: 0.35, cap: 320, size: 8, alpha: 0.8, alphaLight: 0.65, speed: 0.5, twinkle: 0 }),
      dust({ mode: 'bokeh', shape: 'bokeh', count: 0.04, cap: 28, size: 24, alpha: 0.18, alphaLight: 0.14, speed: 0.8, twinkle: 0.2 }),
    ],
    fx: [],
    posters: posters({ opacity: 0.32, blur: 2.2, tint: 0.2, speed: 0.6 }),
  },
  scifi: {
    id: 'scifi',
    followsRoute: false,
    accent: '#3DE0FF',
    accent2: '#7A5CFF',
    accent3: '#FFFFFF',
    particles: [dust({ count: 1, size: 3, alpha: 0.9, alphaLight: 0.5, speed: 0.25, twinkle: 1 })],
    fx: [
      { fx: 'nebula', strength: 1 },
      { fx: 'grid', strength: 1 },
    ],
    posters: posters({ opacity: 0.28, tint: 0.25 }),
  },
  history: {
    id: 'history',
    followsRoute: false,
    accent: '#C9A878',
    accent2: '#7A6A52',
    accent3: '#E8DCC4',
    particles: [dust({ mode: 'fall', shape: 'dot', count: 0.7, size: 3, alpha: 0.6, alphaLight: 0.5, speed: 0.35, twinkle: 0.2 })],
    fx: [{ fx: 'fog', strength: 0.7 }],
    posters: posters({ opacity: 0.28, blur: 2.2, tint: 0.4, speed: 0.4 }),
  },
  western: {
    id: 'western',
    followsRoute: false,
    accent: '#F2A650',
    accent2: '#C8663A',
    accent3: '#FFD9A0',
    particles: [dust({ count: 0.8, size: 4, alpha: 0.8, alphaLight: 0.5, speed: 0.5 })],
    fx: [{ fx: 'shafts', strength: 1.4 }],
    posters: posters({ opacity: 0.32, tint: 0.3, speed: 0.8 }),
  },
}
