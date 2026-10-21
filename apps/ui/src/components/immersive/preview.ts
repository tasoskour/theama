import * as THREE from 'three'
import type { SceneId } from '@theama/contracts'
import { TextureBank, buildSceneGroup, type LayerEnv, type PosterSource, type SceneGroup } from './layers'
import { type QualityProfile } from './quality'
import { paletteFor } from '@/utils/artwork'

/**
 * Thumbnails for the Settings gallery. Browsers allow only a handful of WebGL contexts, so every preview shares
 * ONE offscreen renderer: a scene is drawn into it and copied to the card's own 2D canvas. Cards show a still
 * frame; the one under the pointer is animated (and only that one).
 */

export const PREVIEW_WIDTH = 320
export const PREVIEW_HEIGHT = 200
/** Where in a scene's timeline the still frame is taken, so particles and posters are spread out already. */
const STILL_SECONDS = 7
const ANIMATED_FPS = 30

export interface PreviewOptions {
  dark: boolean
  /** CSS colour painted under the scene, normally the page background. */
  background: string
  /** The quality profile in force; previews are kept small whatever it is. */
  profile: QualityProfile
}

export interface PreviewRenderer {
  /** Draw one still frame of a scene into a 2D canvas. */
  still(target: HTMLCanvasElement, id: SceneId, options: PreviewOptions): void
  /** Animate a scene in a 2D canvas until the returned function is called. Only one animation runs at a time. */
  animate(target: HTMLCanvasElement, id: SceneId, options: PreviewOptions): () => void
  dispose(): void
}

/** A few distinct generated posters, so every preview shows what the scene does to artwork without any network. */
function previewPosters(): PosterSource[] {
  return Array.from({ length: 8 }, (_, i) => {
    const p = paletteFor(`preview:${i}`)
    return { seed: `preview:${i}`, url: null, from: p.from, to: p.to }
  })
}

export function createPreviewRenderer(): PreviewRenderer {
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(1)
  renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.1, 80)
  camera.position.set(0, 0, 8)
  const bank = new TextureBank()
  bank.setPosters(previewPosters())
  const routeAccent = new THREE.Color('#D9B87A')

  function build(id: SceneId, options: PreviewOptions): SceneGroup {
    // Previews stay light: no extra pixel ratio, and a smaller particle budget than the live backdrop.
    const profile: QualityProfile = { ...options.profile, maxPixelRatio: 1, particles: Math.min(options.profile.particles, 700), posterPlanes: Math.min(options.profile.posterPlanes, 12) }
    const env: LayerEnv = { dark: options.dark, profile, pixelRatio: 1, routeAccent, bank }
    const group = buildSceneGroup(id, env)
    scene.add(group.root)
    return group
  }

  function paint(target: HTMLCanvasElement, options: PreviewOptions): void {
    const ctx = target.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, target.width, target.height)
    // The copy must happen in the same task as the render: the drawing buffer is not kept.
    ctx.drawImage(canvas, 0, 0, target.width, target.height)
  }

  let stopCurrent: (() => void) | null = null

  return {
    still(target, id, options) {
      const group = build(id, options)
      group.update(STILL_SECONDS, 1)
      renderer.render(scene, camera)
      paint(target, options)
      group.dispose()
    },
    animate(target, id, options) {
      stopCurrent?.()
      const group = build(id, options)
      const begin = performance.now()
      let raf = 0
      let last = 0
      const tick = (now: number): void => {
        raf = requestAnimationFrame(tick)
        if (last !== 0 && now - last < 1000 / ANIMATED_FPS - 1) return
        last = now
        group.update(STILL_SECONDS + (now - begin) / 1000, 1)
        renderer.render(scene, camera)
        paint(target, options)
      }
      raf = requestAnimationFrame(tick)
      const stop = (): void => {
        cancelAnimationFrame(raf)
        group.dispose()
        if (stopCurrent === stop) stopCurrent = null
      }
      stopCurrent = stop
      return stop
    },
    dispose() {
      stopCurrent?.()
      bank.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
