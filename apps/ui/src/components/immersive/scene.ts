import * as THREE from 'three'
import type { SceneId } from '@theama/contracts'
import { TextureBank, buildSceneGroup, type LayerEnv, type PosterSource, type SceneGroup } from './layers'
import { SAMPLE_FRAMES, isStruggling, pixelRatioFor, slowLimitFor, type QualityProfile } from './quality'

/**
 * The 3D backdrop: a renderer, a camera that drifts with the pointer and the page, and one scene at a time
 * (dust, light, floating posters...) that cross-fades into the next when the context changes.
 * Plain TypeScript with no Vue in it, so the component stays small and the whole thing is torn down by one call.
 * It draws only; nothing here is interactive or readable by assistive technology.
 */

export type { PosterSource } from './layers'

export interface SceneOptions {
  canvas: HTMLCanvasElement
  profile: QualityProfile
  dark: boolean
  scene: SceneId
  /** Hex colour the original scene is tinted with (the route tint). */
  accent: string
  /** The frame rate stayed too low for the first moments of this profile. */
  onStruggle: () => void
  /** The graphics context was lost. `count` is how many times so far. */
  onContextLost: (count: number) => void
}

export interface ImmersiveScene {
  resize(): void
  setProfile(profile: QualityProfile): void
  setDark(dark: boolean): void
  setAccent(hex: string): void
  /** Cross-fade to another scene. */
  setScene(id: SceneId): void
  setPosters(posters: readonly PosterSource[]): void
  /** Pointer position as -1..1 on each axis. */
  setPointer(x: number, y: number): void
  /** Page scroll in pixels. */
  setScroll(y: number): void
  /** A short camera push, played when the page changes. */
  dolly(): void
  dispose(): void
}

const DOLLY_MS = 900
const FADE_IN_MS = 1400
/** Seconds for one scene to dissolve into the next. */
const CROSSFADE_S = 0.9

interface Slot {
  group: SceneGroup
  fade: number
  target: number
}

export function createScene(options: SceneOptions): ImmersiveScene {
  const { canvas } = options
  let profile = options.profile
  let dark = options.dark
  let sceneId = options.scene

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80)
  camera.position.set(0, 0, 8)

  const routeAccent = new THREE.Color(options.accent)
  const accentTarget = new THREE.Color(options.accent)
  const bank = new TextureBank()
  const env: LayerEnv = { dark, profile, pixelRatio: 1, routeAccent, bank }

  let slots: Slot[] = []

  function addSlot(id: SceneId, fade: number): void {
    env.dark = dark
    env.profile = profile
    const group = buildSceneGroup(id, env)
    scene.add(group.root)
    slots.push({ group, fade, target: 1 })
  }
  function clearSlots(): void {
    for (const s of slots) s.group.dispose()
    slots = []
  }
  /** Rebuild the current scene in place (quality, light/dark or a restored context): no cross-fade. */
  function rebuild(): void {
    clearSlots()
    addSlot(sceneId, 1)
    applyPixelRatio()
  }
  bank.onChange = () => {
    for (const s of slots) s.group.refresh()
  }

  function applyPixelRatio(): void {
    env.pixelRatio = pixelRatioFor(profile, window.devicePixelRatio)
    renderer.setPixelRatio(env.pixelRatio)
    resize()
  }

  function resize(): void {
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  // --- motion ---------------------------------------------------------------------------------
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
  let scrollTarget = 0
  let scrollY = 0
  let dollyStart = -Infinity
  const bornAt = performance.now()
  let lastFrame = bornAt

  function intro(now: number): number {
    const t = Math.min(1, (now - bornAt) / FADE_IN_MS)
    return t * t * (3 - 2 * t)
  }

  function frame(now: number, seconds: number): void {
    const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000))
    lastFrame = now
    const f = intro(now)
    routeAccent.lerp(accentTarget, 0.04)

    pointer.x += (pointer.tx - pointer.x) * 0.05
    pointer.y += (pointer.ty - pointer.y) * 0.05
    scrollY += (scrollTarget - scrollY) * 0.06

    const dp = (now - dollyStart) / DOLLY_MS
    const dolly = dp >= 0 && dp < 1 ? -1.4 * Math.sin(Math.PI * dp) * (1 - dp) : 0
    camera.position.set(pointer.x * 0.8, pointer.y * 0.5 + scrollY, 8 + dolly)
    camera.lookAt(pointer.x * 0.2, scrollY * 0.6, 0)

    const step = dt / CROSSFADE_S
    for (const s of slots) {
      s.fade += Math.max(-step, Math.min(step, s.target - s.fade))
      s.group.update(seconds, s.fade * f)
    }
    // A scene that has fully dissolved is released, so switching scenes never accumulates GPU memory.
    const gone = slots.filter((s) => s.target === 0 && s.fade <= 0)
    if (gone.length > 0) {
      for (const s of gone) s.group.dispose()
      slots = slots.filter((s) => !gone.includes(s))
    }
    renderer.render(scene, camera)
  }

  // --- loop -----------------------------------------------------------------------------------
  let raf = 0
  let running = false
  let last = 0
  let sample: number[] = []
  let sampling = true
  let contextLosses = 0
  let disposed = false
  const origin = performance.now()

  function tick(now: number): void {
    if (!running) return
    raf = requestAnimationFrame(tick)
    const minGap = profile.maxFps > 0 ? 1000 / profile.maxFps - 1 : 0
    if (last !== 0 && now - last < minGap) return
    if (sampling && last !== 0) {
      sample.push(now - last)
      if (sample.length >= SAMPLE_FRAMES) {
        sampling = false
        if (isStruggling(sample, slowLimitFor(profile))) options.onStruggle()
      }
    }
    last = now
    frame(now, (now - origin) / 1000)
  }

  function start(): void {
    if (running || disposed) return
    running = true
    last = 0 // the gap while paused is not a slow frame
    lastFrame = performance.now()
    raf = requestAnimationFrame(tick)
  }
  function stop(): void {
    running = false
    cancelAnimationFrame(raf)
  }
  const onVisibility = (): void => (document.hidden ? stop() : start())
  const onLost = (e: Event): void => {
    e.preventDefault()
    stop()
    contextLosses++
    options.onContextLost(contextLosses)
  }
  const onRestored = (): void => {
    rebuild()
    start()
  }
  document.addEventListener('visibilitychange', onVisibility)
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  addSlot(sceneId, 1)
  applyPixelRatio()
  if (!document.hidden) start()

  return {
    resize,
    setProfile(next) {
      profile = next
      sample = []
      sampling = true
      rebuild()
    },
    setDark(next) {
      if (next === dark) return
      dark = next
      rebuild()
    },
    setAccent(hex) {
      accentTarget.set(hex)
    },
    setScene(id) {
      if (id === sceneId) return
      sceneId = id
      for (const s of slots) s.target = 0
      addSlot(id, 0)
    },
    setPosters(next) {
      bank.setPosters(next)
      for (const s of slots) s.group.refresh()
    },
    setPointer(x, y) {
      pointer.tx = x
      pointer.ty = y
    },
    setScroll(y) {
      scrollTarget = -Math.min(Math.max(y, 0), 3000) * 0.0015
    },
    dolly() {
      dollyStart = performance.now()
    },
    dispose() {
      disposed = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      clearSlots()
      bank.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
