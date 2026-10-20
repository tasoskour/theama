import * as THREE from 'three'
import { SAMPLE_FRAMES, isStruggling, pixelRatioFor, slowLimitFor, type QualityProfile } from './quality'

/**
 * The 3D backdrop: drifting dust, soft light shafts and dim, out-of-focus posters floating in depth.
 * Plain TypeScript with no Vue in it, so the component stays small and the whole scene can be torn
 * down by one call. It draws only; nothing here is interactive or readable by assistive technology.
 */

export interface PosterSource {
  /** Stable id, also the seed for the stand-in colours. */
  seed: string
  url: string | null
  /** Stand-in gradient, used until (or instead of) the artwork. */
  from: string
  to: string
}

export interface SceneOptions {
  canvas: HTMLCanvasElement
  profile: QualityProfile
  dark: boolean
  /** Hex colour the whole scene is tinted with. */
  accent: string
  /** The frame rate stayed too low for the first moments of this profile. */
  onStruggle: () => void
  /** The graphics context was lost. `count` is how many times so far. */
  onContextLost: (count: number) => void
}

export interface ImmersiveScene {
  resize(): void
  setProfile(profile: QualityProfile): void
  setTheme(dark: boolean): void
  setAccent(hex: string): void
  setPosters(posters: readonly PosterSource[]): void
  /** Pointer position as -1..1 on each axis. */
  setPointer(x: number, y: number): void
  /** Page scroll in pixels. */
  setScroll(y: number): void
  /** A short camera push, played when the page changes. */
  dolly(): void
  dispose(): void
}

const FIELD_WIDTH = 40
const DOLLY_MS = 900
const FADE_IN_MS = 1400

const uniform = <T>(value: T): THREE.IUniform<T> => ({ value })

const PARTICLE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;
  attribute float aSeed;
  varying float vTwinkle;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.15 + aSeed * 20.0) * 0.6;
    p.y = mod(position.y + uTime * (0.12 + aSeed * 0.2) + 9.0, 18.0) - 9.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.6 + aSeed) * uPixelRatio * (12.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
    vTwinkle = 0.5 + 0.5 * sin(uTime * 0.8 + aSeed * 40.0);
  }
`
const PARTICLE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * uAlpha * (0.35 + 0.65 * vTwinkle));
    #include <colorspace_fragment>
  }
`
const FLAT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SHAFT_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - vec2(0.22, 1.1);
    float ang = atan(p.x, -p.y);
    float beams = (0.5 + 0.5 * sin(ang * 14.0 + uTime * 0.15)) * (0.5 + 0.5 * sin(ang * 5.0 - uTime * 0.1));
    float fall = smoothstep(1.4, 0.0, length(p));
    gl_FragColor = vec4(uColor, beams * fall * uAlpha);
    #include <colorspace_fragment>
  }
`
// A biased lookup into the mip chain is a cheap blur, which keeps the posters atmospheric rather than readable.
const POSTER_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uBias;
  uniform vec3 uTint;
  uniform float uTintMix;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uMap, vUv, uBias);
    vec2 e = min(vUv, 1.0 - vUv);
    float edge = smoothstep(0.0, 0.14, min(e.x, e.y));
    gl_FragColor = vec4(mix(c.rgb, uTint, uTintMix), uOpacity * edge);
    #include <colorspace_fragment>
  }
`

interface Floater {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  baseX: number
  baseY: number
  speed: number
  bob: number
  phase: number
}

/** Low discrepancy, so posters spread evenly over the field whatever the count. */
const GOLDEN = 0.6180339887

function gradientTexture(from: string, to: string): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 24
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 16, 24)
    g.addColorStop(0, from)
    g.addColorStop(1, to)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 16, 24)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function createScene(options: SceneOptions): ImmersiveScene {
  const { canvas } = options
  let profile = options.profile
  let dark = options.dark

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80)
  camera.position.set(0, 0, 8)

  const accent = new THREE.Color(options.accent)
  const accentTarget = new THREE.Color(options.accent)
  const shared = {
    uTime: uniform(0),
    uColor: uniform(accent),
    uPixelRatio: uniform(1),
  }

  let particles: THREE.Points | null = null
  let shafts: THREE.Mesh | null = null
  let floaters: Floater[] = []
  let posters: readonly PosterSource[] = []

  // Artwork is shared between planes and kept for the life of the scene; a failed load keeps the stand-in.
  const loader = new THREE.TextureLoader()
  loader.setCrossOrigin('anonymous')
  const artwork = new Map<string, THREE.Texture>()
  const failed = new Set<string>()
  const standIns = new Map<string, THREE.Texture>()

  function standIn(p: PosterSource): THREE.Texture {
    let t = standIns.get(p.seed)
    if (!t) {
      t = gradientTexture(p.from, p.to)
      standIns.set(p.seed, t)
    }
    return t
  }

  function textureFor(p: PosterSource, onReady: () => void): THREE.Texture {
    if (!p.url || failed.has(p.url)) return standIn(p)
    const cached = artwork.get(p.url)
    if (cached) return cached
    const url = p.url
    loader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        artwork.set(url, t)
        onReady()
      },
      undefined,
      () => failed.add(url),
    )
    return standIn(p)
  }

  function clearBuilt(): void {
    if (particles) {
      scene.remove(particles)
      particles.geometry.dispose()
      ;(particles.material as THREE.Material).dispose()
      particles = null
    }
    if (shafts) {
      scene.remove(shafts)
      shafts.geometry.dispose()
      ;(shafts.material as THREE.Material).dispose()
      shafts = null
    }
    for (const f of floaters) {
      scene.remove(f.mesh)
      f.mesh.geometry.dispose()
      f.material.dispose()
    }
    floaters = []
  }

  const blending = (): THREE.Blending => (dark ? THREE.AdditiveBlending : THREE.NormalBlending)

  function buildParticles(): void {
    const n = profile.particles
    const positions = new Float32Array(n * 3)
    const seeds = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 32
      positions[i * 3 + 1] = (Math.random() - 0.5) * 18
      positions[i * 3 + 2] = -22 + Math.random() * 26
      seeds[i] = Math.random()
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    const material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { ...shared, uSize: uniform(5), uAlpha: uniform(0) },
      transparent: true,
      depthWrite: false,
      blending: blending(),
    })
    particles = new THREE.Points(geometry, material)
    particles.frustumCulled = false
    scene.add(particles)
  }

  function buildShafts(): void {
    if (!profile.lightShafts) return
    const material = new THREE.ShaderMaterial({
      vertexShader: FLAT_VERT,
      fragmentShader: SHAFT_FRAG,
      uniforms: { uTime: shared.uTime, uColor: shared.uColor, uAlpha: uniform(0) },
      transparent: true,
      depthWrite: false,
      blending: blending(),
    })
    shafts = new THREE.Mesh(new THREE.PlaneGeometry(90, 56), material)
    shafts.position.z = -26
    scene.add(shafts)
  }

  function fallbackSources(): PosterSource[] {
    return Array.from({ length: 4 }, (_, i) => ({ seed: `ghost:${i}`, url: null, from: '#3A2F1F', to: '#16120C' }))
  }

  function assignTextures(): void {
    const sources = posters.length ? posters : fallbackSources()
    floaters.forEach((f, i) => {
      const src = sources[i % sources.length]!
      f.material.uniforms.uMap!.value = textureFor(src, assignTextures)
    })
  }

  function buildFloaters(): void {
    const sources = posters.length ? posters : fallbackSources()
    for (let i = 0; i < profile.posterPlanes; i++) {
      const src = sources[i % sources.length]!
      const material = new THREE.ShaderMaterial({
        vertexShader: FLAT_VERT,
        fragmentShader: POSTER_FRAG,
        uniforms: {
          uMap: uniform(textureFor(src, assignTextures)),
          uOpacity: uniform(0),
          uBias: uniform(3.2),
          uTint: shared.uColor,
          uTintMix: uniform(0.18),
        },
        transparent: true,
        depthWrite: false,
      })
      const scale = 2.4 + ((i * GOLDEN * 7) % 1) * 2.2
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * (scale / 3), 3 * (scale / 3)), material)
      const lane = (i * GOLDEN) % 1
      const baseZ = -7 - (((i * GOLDEN * 3) % 1) * 16)
      mesh.position.z = baseZ
      mesh.rotation.y = (lane - 0.5) * 0.5
      mesh.rotation.z = (((i * 0.37) % 1) - 0.5) * 0.18
      scene.add(mesh)
      floaters.push({
        mesh,
        material,
        baseX: (lane - 0.5) * FIELD_WIDTH,
        baseY: ((((i * GOLDEN * 5) % 1) - 0.5) * 14),
        speed: 0.18 + (((i * 0.53) % 1) * 0.22),
        bob: 0.3 + ((i * 0.29) % 1) * 0.5,
        phase: i * 1.7,
      })
    }
  }

  function build(): void {
    clearBuilt()
    buildShafts()
    buildParticles()
    buildFloaters()
    applyPixelRatio()
  }

  function applyPixelRatio(): void {
    const ratio = pixelRatioFor(profile, window.devicePixelRatio)
    renderer.setPixelRatio(ratio)
    shared.uPixelRatio.value = ratio
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

  function fade(now: number): number {
    const t = Math.min(1, (now - bornAt) / FADE_IN_MS)
    return t * t * (3 - 2 * t)
  }

  function frame(now: number, seconds: number): void {
    const f = fade(now)
    shared.uTime.value = seconds
    accent.lerp(accentTarget, 0.04)

    pointer.x += (pointer.tx - pointer.x) * 0.05
    pointer.y += (pointer.ty - pointer.y) * 0.05
    scrollY += (scrollTarget - scrollY) * 0.06

    const dp = (now - dollyStart) / DOLLY_MS
    const dolly = dp >= 0 && dp < 1 ? -1.4 * Math.sin(Math.PI * dp) * (1 - dp) : 0
    camera.position.set(pointer.x * 0.8, pointer.y * 0.5 + scrollY, 8 + dolly)
    camera.lookAt(pointer.x * 0.2, scrollY * 0.6, 0)

    if (particles) {
      const u = (particles.material as THREE.ShaderMaterial).uniforms
      u.uAlpha!.value = (dark ? 0.9 : 0.5) * f
    }
    if (shafts) {
      // Off on light backgrounds: at that faintness 8-bit colour shows as visible banding.
      ;(shafts.material as THREE.ShaderMaterial).uniforms.uAlpha!.value = (dark ? 0.1 : 0) * f
    }
    const half = FIELD_WIDTH / 2
    for (const fl of floaters) {
      const x = ((((fl.baseX + seconds * fl.speed + half) % FIELD_WIDTH) + FIELD_WIDTH) % FIELD_WIDTH) - half
      fl.mesh.position.x = x
      fl.mesh.position.y = fl.baseY + Math.sin(seconds * 0.3 + fl.phase) * fl.bob
      const edge = THREE.MathUtils.smoothstep(half - Math.abs(x), 0, 5)
      fl.material.uniforms.uOpacity!.value = (dark ? 0.3 : 0.15) * edge * f
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
    build()
    start()
  }
  document.addEventListener('visibilitychange', onVisibility)
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  build()
  if (!document.hidden) start()

  return {
    resize,
    setProfile(next) {
      profile = next
      sample = []
      sampling = true
      build()
    },
    setTheme(next) {
      dark = next
      const b = blending()
      if (particles) {
        const m = particles.material as THREE.ShaderMaterial
        m.blending = b
        m.needsUpdate = true
      }
      if (shafts) {
        const m = shafts.material as THREE.ShaderMaterial
        m.blending = b
        m.needsUpdate = true
      }
    },
    setAccent(hex) {
      accentTarget.set(hex)
    },
    setPosters(next) {
      posters = next
      assignTextures()
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
      clearBuilt()
      for (const t of artwork.values()) t.dispose()
      for (const t of standIns.values()) t.dispose()
      artwork.clear()
      standIns.clear()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
