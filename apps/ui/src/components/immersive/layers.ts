import * as THREE from 'three'
import { fxAllowed, type BackdropFx, type QualityProfile } from './quality'
import { THEMES, type FxSpec, type ParticleMode, type ParticleShape, type ParticleSpec, type PosterSpec, type SceneTheme } from './themes'
import type { SceneId } from '@theama/contracts'

/**
 * The drawing pieces a scene is made of: particles, full-screen effects and floating posters.
 * A scene (or a Settings preview) asks for a whole group at once and gets back one object to update and dispose.
 */

export interface PosterSource {
  /** Stable id, also the seed for the stand-in colours. */
  seed: string
  url: string | null
  /** Stand-in gradient, used until (or instead of) the artwork. */
  from: string
  to: string
}

export interface LayerEnv {
  dark: boolean
  profile: QualityProfile
  pixelRatio: number
  /** The route tint, lerped by the scene; only scenes that follow the route read it. */
  routeAccent: THREE.Color
  bank: TextureBank
}

export interface Layer {
  object: THREE.Object3D
  /** Advance to `seconds`; `fade` (0..1) is how visible the whole group is. */
  update(seconds: number, fade: number): void
  /** Textures may have changed (artwork arrived); reassign them. */
  refresh?(): void
  dispose(): void
}

export interface SceneGroup {
  root: THREE.Group
  update(seconds: number, fade: number): void
  refresh(): void
  dispose(): void
}

const FIELD_WIDTH = 40
const GOLDEN = 0.6180339887
const uniform = <T>(value: T): THREE.IUniform<T> => ({ value })

// --- textures ---------------------------------------------------------------------------------

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

const FALLBACK: readonly PosterSource[] = Array.from({ length: 4 }, (_, i) => ({ seed: `ghost:${i}`, url: null, from: '#3A2F1F', to: '#16120C' }))

/**
 * Artwork shared by every layer and kept for the life of the scene. A failed or missing load keeps the generated
 * stand-in, so the scene never waits on, or breaks because of, the network.
 */
export class TextureBank {
  private readonly loader = new THREE.TextureLoader()
  private readonly artwork = new Map<string, THREE.Texture>()
  private readonly failed = new Set<string>()
  private readonly pending = new Map<string, symbol>()
  private disposed = false
  private readonly standIns = new Map<string, THREE.Texture>()
  private posters: readonly PosterSource[] = []
  /** Called when artwork finishes loading. */
  onChange: () => void = () => undefined

  constructor() {
    this.loader.setCrossOrigin('anonymous')
  }

  setPosters(posters: readonly PosterSource[]): void {
    this.posters = posters
    // Refresh materials before releasing the textures they used to reference.
    this.onChange()
    const urls = new Set(this.sources.flatMap(p => p.url ? [p.url] : []))
    const seeds = new Set(this.sources.map(p => p.seed))
    for (const [url, texture] of this.artwork) if (!urls.has(url)) { texture.dispose(); this.artwork.delete(url) }
    for (const [seed, texture] of this.standIns) if (!seeds.has(seed)) { texture.dispose(); this.standIns.delete(seed) }
    for (const url of this.failed) if (!urls.has(url)) this.failed.delete(url)
    for (const url of this.pending.keys()) if (!urls.has(url)) this.pending.delete(url)
  }

  private get sources(): readonly PosterSource[] {
    return this.posters.length > 0 ? this.posters : FALLBACK
  }

  textureAt(index: number): THREE.Texture {
    const src = this.sources[index % this.sources.length]!
    if (!src.url || this.failed.has(src.url)) return this.standIn(src)
    const cached = this.artwork.get(src.url)
    if (cached) return cached
    const url = src.url
    if (this.pending.has(url)) return this.standIn(src)
    const token = Symbol(url)
    this.pending.set(url, token)
    this.loader.load(
      url,
      (t) => {
        if (this.disposed || this.pending.get(url) !== token) { t.dispose(); return }
        this.pending.delete(url)
        t.colorSpace = THREE.SRGBColorSpace
        this.artwork.set(url, t)
        this.onChange()
      },
      undefined,
      () => {
        if (this.disposed || this.pending.get(url) !== token) return
        this.pending.delete(url)
        this.failed.add(url)
      },
    )
    return this.standIn(src)
  }

  private standIn(p: PosterSource): THREE.Texture {
    let t = this.standIns.get(p.seed)
    if (!t) {
      t = gradientTexture(p.from, p.to)
      this.standIns.set(p.seed, t)
    }
    return t
  }

  dispose(): void {
    this.disposed = true
    this.pending.clear()
    this.failed.clear()
    this.onChange = () => undefined
    for (const t of this.artwork.values()) t.dispose()
    for (const t of this.standIns.values()) t.dispose()
    this.artwork.clear()
    this.standIns.clear()
  }
}

// --- colour -----------------------------------------------------------------------------------

/** On a light page every colour is deepened a little, so it reads as ink rather than washing out. */
function tone(hex: string, dark: boolean): THREE.Color {
  const c = new THREE.Color(hex)
  return dark ? c : c.multiplyScalar(0.7)
}

// --- particles --------------------------------------------------------------------------------

const MODE_ID: Record<ParticleMode, number> = { drift: 0, rise: 1, fall: 2, wander: 3, rain: 4, bokeh: 5 }
const SHAPE_ID: Record<ParticleShape, number> = { dot: 0, streak: 1, bokeh: 2, confetti: 3, petal: 4, bubble: 5 }

const PARTICLE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;
  uniform float uSpeed;
  uniform float uMode;
  attribute float aSeed;
  varying float vTwinkle;
  varying float vSeed;
  varying float vLife;
  void main() {
    vec3 p = position;
    float t = uTime * uSpeed;
    float life = 1.0;
    float tw = 0.5 + 0.5 * sin(uTime * 0.8 + aSeed * 40.0);
    if (uMode < 0.5) {
      // drift: the original dust
      p.x += sin(uTime * 0.15 + aSeed * 20.0) * 0.6;
      p.y = mod(position.y + t * (0.12 + aSeed * 0.2) + 9.0, 18.0) - 9.0;
    } else if (uMode < 1.5) {
      // rise: embers that cool as they climb
      p.x += sin(uTime * 0.6 + aSeed * 30.0) * 0.5;
      p.y = mod(position.y + t * (0.5 + aSeed * 0.9) + 9.0, 18.0) - 9.0;
      life = 1.0 - (p.y + 9.0) / 18.0;
    } else if (uMode < 2.5) {
      // fall: snow, ash, petals, confetti
      p.x += sin(uTime * 0.5 + aSeed * 30.0) * 0.8;
      p.y = mod(position.y - t * (0.35 + aSeed * 0.6) + 9.0, 18.0) - 9.0;
    } else if (uMode < 3.5) {
      // wander: fireflies
      p += vec3(sin(uTime * 0.4 + aSeed * 17.0), cos(uTime * 0.35 + aSeed * 23.0), sin(uTime * 0.3 + aSeed * 11.0)) * 1.2;
      tw = pow(0.5 + 0.5 * sin(uTime * 1.6 + aSeed * 40.0), 3.0);
    } else if (uMode < 4.5) {
      // rain
      p.y = mod(position.y - t * (6.0 + aSeed * 5.0) + 9.0, 18.0) - 9.0;
    } else {
      // bokeh: big soft shapes drifting slowly
      p.x += sin(uTime * 0.1 * uSpeed + aSeed * 20.0) * 1.5;
      p.y += cos(uTime * 0.08 * uSpeed + aSeed * 13.0) * 1.0;
    }
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.6 + aSeed) * uPixelRatio * (12.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
    vTwinkle = tw;
    vSeed = aSeed;
    vLife = life;
  }
`

const PARTICLE_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uAlpha;
  uniform float uMode;
  uniform float uShape;
  uniform float uTwinkle;
  uniform float uTime;
  varying float vTwinkle;
  varying float vSeed;
  varying float vLife;
  mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
  void main() {
    vec2 pc = gl_PointCoord;
    float d = length(pc - 0.5);
    float a;
    if (uShape < 0.5) {
      a = smoothstep(0.5, 0.0, d);
    } else if (uShape < 1.5) {
      // streak: a thin line, brightest at its leading end
      a = smoothstep(0.035, 0.0, abs(pc.x - 0.5)) * smoothstep(0.0, 1.0, 1.0 - pc.y) * smoothstep(0.0, 0.12, pc.y);
    } else if (uShape < 2.5) {
      // bokeh: a flat disc with a slightly brighter rim
      a = smoothstep(0.5, 0.4, d) * 0.55 + smoothstep(0.5, 0.46, d) * smoothstep(0.38, 0.46, d) * 0.45;
    } else if (uShape < 3.5) {
      // confetti: a tumbling rectangle
      vec2 r = rot(uTime * (1.0 + vSeed * 3.0) + vSeed * 6.2832) * (pc - 0.5);
      a = smoothstep(0.34, 0.3, abs(r.x)) * smoothstep(0.18, 0.14, abs(r.y));
    } else if (uShape < 4.5) {
      // petal: a tumbling ellipse
      vec2 r = rot(uTime * (0.6 + vSeed * 1.4) + vSeed * 6.2832) * (pc - 0.5);
      float e = pow(r.x / 0.42, 2.0) + pow(r.y / 0.2, 2.0);
      a = smoothstep(1.0, 0.7, e);
    } else {
      // bubble: a ring with a faint fill and a glint
      a = smoothstep(0.5, 0.44, d) * smoothstep(0.32, 0.46, d) * 0.9 + smoothstep(0.5, 0.0, d) * 0.18;
      a += smoothstep(0.09, 0.0, length(pc - vec2(0.34, 0.34))) * 0.6;
    }
    vec3 col = vSeed < 0.34 ? uColorA : (vSeed < 0.67 ? uColorB : uColorC);
    if (uMode > 0.5 && uMode < 1.5) col = mix(uColorA, uColorB, 1.0 - vLife);
    float tw = mix(1.0, 0.35 + 0.65 * vTwinkle, uTwinkle);
    float life = (uMode > 0.5 && uMode < 1.5) ? vLife : 1.0;
    gl_FragColor = vec4(col, a * uAlpha * tw * life);
    #include <colorspace_fragment>
  }
`

function particleLayer(spec: ParticleSpec, theme: SceneTheme, env: LayerEnv): Layer | null {
  const n = Math.min(Math.round(env.profile.particles * spec.count), spec.cap ?? Infinity)
  if (n < 1) return null
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
  const colorA = theme.followsRoute ? env.routeAccent : tone(theme.accent, env.dark)
  const material = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms: {
      uTime: uniform(0),
      uPixelRatio: uniform(env.pixelRatio),
      uSize: uniform(spec.size),
      uSpeed: uniform(spec.speed),
      uMode: uniform(MODE_ID[spec.mode]),
      uShape: uniform(SHAPE_ID[spec.shape]),
      uTwinkle: uniform(spec.twinkle),
      uColorA: uniform(colorA),
      uColorB: uniform(theme.followsRoute ? env.routeAccent : tone(theme.accent2, env.dark)),
      uColorC: uniform(theme.followsRoute ? env.routeAccent : tone(theme.accent3, env.dark)),
      uAlpha: uniform(0),
    },
    transparent: true,
    depthWrite: false,
    blending: env.dark ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  const base = env.dark ? spec.alpha : spec.alphaLight
  return {
    object: points,
    update(seconds, fade) {
      material.uniforms.uTime!.value = seconds
      material.uniforms.uAlpha!.value = base * fade
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

// --- full-screen effects ----------------------------------------------------------------------

const FLAT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Shared by the effect shaders: hash, value noise, fbm, and a dither that hides 8-bit banding in faint gradients. */
const FX_COMMON = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uAlpha;
  varying vec2 vUv;
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  vec4 finish(vec3 col, float a) {
    a = clamp(a, 0.0, 1.0);
    if (a < 0.0005) discard;
    a = max(0.0, a + (hash21(gl_FragCoord.xy) - 0.5) / 160.0);
    return vec4(col, a);
  }
`

const FX_FRAG: Record<BackdropFx, string> = {
  // The original light shafts, with the origin as a uniform so scenes can aim them.
  shafts: /* glsl */ `
    uniform vec2 uOrigin;
    void main() {
      vec2 p = vUv - uOrigin;
      float ang = atan(p.x, -p.y);
      float beams = (0.5 + 0.5 * sin(ang * 14.0 + uTime * 0.15)) * (0.5 + 0.5 * sin(ang * 5.0 - uTime * 0.1));
      float fall = smoothstep(1.4, 0.0, length(p));
      gl_FragColor = vec4(uColorA, beams * fall * uAlpha);
      #include <colorspace_fragment>
    }
  `,
  aurora: /* glsl */ `
    void main() {
      float x = vUv.x;
      float t = uTime * 0.08;
      vec3 col = vec3(0.0);
      float band = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float y = 0.7 + 0.09 * fi + 0.07 * sin(x * (3.0 + fi) + t * (1.0 + fi * 0.5) + fi * 2.0) + 0.04 * sin(x * 9.0 - t * 2.0);
        float w = smoothstep(0.17 + 0.03 * fi, 0.0, abs(vUv.y - y));
        col += mix(uColorA, uColorB, fi / 2.0) * w;
        band += w;
      }
      float shimmer = 0.65 + 0.35 * sin(x * 6.0 + uTime * 0.2);
      gl_FragColor = finish(col / max(band, 0.001), band * 0.4 * shimmer * uAlpha);
      #include <colorspace_fragment>
    }
  `,
  nebula: /* glsl */ `
    void main() {
      vec2 p = vUv * vec2(2.6, 1.7);
      float t = uTime * 0.02;
      float n = fbm(p + vec2(t, -t * 0.6));
      float m = fbm(p * 1.7 - vec2(t * 0.7, t) + 4.0);
      float a = smoothstep(0.32, 0.88, n) * (0.55 + 0.45 * m);
      gl_FragColor = finish(mix(uColorA, uColorB, m), a * uAlpha);
      #include <colorspace_fragment>
    }
  `,
  fog: /* glsl */ `
    void main() {
      vec2 p = vec2(vUv.x * 3.2 + uTime * 0.03, vUv.y * 2.0);
      float n = fbm(p + vec2(0.0, uTime * 0.01));
      float a = n * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.2);
      gl_FragColor = finish(uColorA, a * uAlpha);
      #include <colorspace_fragment>
    }
  `,
  grid: /* glsl */ `
    void main() {
      float horizon = 0.46;
      if (vUv.y > horizon) discard;
      float depth = horizon - vUv.y;
      float z = 0.12 / max(depth, 0.002);
      float gx = abs(fract((vUv.x - 0.5) * z * 14.0) - 0.5);
      float gz = abs(fract(z * 2.5 - uTime * 0.5) - 0.5);
      float line = max(smoothstep(0.46, 0.5, gx), smoothstep(0.46, 0.5, gz));
      float fade = smoothstep(0.0, 0.05, depth) * (1.0 - smoothstep(0.12, 0.3, depth));
      gl_FragColor = finish(mix(uColorA, uColorB, smoothstep(0.0, 0.3, depth)), line * fade * uAlpha);
      #include <colorspace_fragment>
    }
  `,
  flicker: /* glsl */ `
    void main() {
      vec2 q = (vUv - 0.5) * vec2(1.2, 1.0);
      float vign = smoothstep(0.3, 0.85, length(q));
      float slow = 0.8 + 0.2 * sin(uTime * 2.3) * sin(uTime * 0.7 + 1.0);
      float hit = step(0.985, hash21(vec2(floor(uTime * 9.0), 3.0))) * 0.4;
      gl_FragColor = finish(vec3(0.0), vign * (slow + hit) * uAlpha);
      #include <colorspace_fragment>
    }
  `,
}

/** Opacity of each effect at strength 1, on a dark and on a light page; and whether it adds light or covers it. */
const FX_BASE: Record<BackdropFx, { dark: number; light: number; additive: boolean }> = {
  shafts: { dark: 0.1, light: 0, additive: true }, // light 0: at that faintness 8-bit colour shows as banding
  aurora: { dark: 0.3, light: 0.12, additive: true },
  nebula: { dark: 0.3, light: 0.14, additive: true },
  fog: { dark: 0.2, light: 0.14, additive: false },
  grid: { dark: 0.3, light: 0.14, additive: true },
  flicker: { dark: 0.55, light: 0, additive: false },
}

/** Where each scene aims its light shafts, in the effect plane's UV space. The default is the original top-left source. */
const SHAFT_ORIGIN: Partial<Record<SceneId, [number, number]>> = {
  movie: [0.5, 1.2], // a projector beam from above the middle
  western: [0.88, 0.62], // a low sun on the right
  action: [0.1, 1.15],
  drama: [0.3, 1.15],
}

function fxLayer(spec: FxSpec, theme: SceneTheme, env: LayerEnv): Layer | null {
  if (!fxAllowed(spec.fx, env.profile)) return null
  const base = FX_BASE[spec.fx]
  const peak = (env.dark ? base.dark : base.light) * spec.strength
  if (peak <= 0) return null
  const origin = SHAFT_ORIGIN[theme.id] ?? [0.22, 1.1]
  const material = new THREE.ShaderMaterial({
    vertexShader: FLAT_VERT,
    fragmentShader: FX_COMMON + FX_FRAG[spec.fx],
    uniforms: {
      uTime: uniform(0),
      uAlpha: uniform(0),
      uColorA: uniform(theme.followsRoute ? env.routeAccent : tone(theme.accent, env.dark)),
      uColorB: uniform(theme.followsRoute ? env.routeAccent : tone(theme.accent2, env.dark)),
      uOrigin: uniform(new THREE.Vector2(origin[0], origin[1])),
    },
    transparent: true,
    depthWrite: false,
    blending: base.additive && env.dark ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(90, 56), material)
  mesh.position.z = -26
  return {
    object: mesh,
    update(seconds, fade) {
      material.uniforms.uTime!.value = seconds
      material.uniforms.uAlpha!.value = peak * fade
    },
    dispose() {
      mesh.geometry.dispose()
      material.dispose()
    },
  }
}

// --- floating posters -------------------------------------------------------------------------

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
  index: number
}

function postersLayer(spec: PosterSpec, theme: SceneTheme, env: LayerEnv): Layer {
  const n = Math.max(2, Math.round(env.profile.posterPlanes * spec.count))
  const geometry = new THREE.PlaneGeometry(2, 3)
  const root = new THREE.Group()
  const tint = theme.followsRoute ? env.routeAccent : tone(theme.accent, env.dark)
  const lanes = n >= 12 ? 7 : 5
  const perLane = Math.ceil(n / lanes)
  const floaters: Floater[] = []

  for (let i = 0; i < n; i++) {
    const material = new THREE.ShaderMaterial({
      vertexShader: FLAT_VERT,
      fragmentShader: POSTER_FRAG,
      uniforms: {
        uMap: uniform(env.bank.textureAt(i)),
        uOpacity: uniform(0),
        uBias: uniform(spec.blur),
        uTint: uniform(tint),
        uTintMix: uniform(spec.tint),
      },
      transparent: true,
      depthWrite: false,
      side: spec.layout === 'ring' ? THREE.DoubleSide : THREE.FrontSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    // Size and depth are spread evenly whatever the count (low-discrepancy sequence).
    const scale = (spec.layout === 'columns' ? 1.9 : 2.4 + ((i * GOLDEN * 7) % 1) * 2.2) / 3
    mesh.scale.setScalar(scale)
    root.add(mesh)
    floaters.push({ mesh, material, index: i })
  }

  const half = FIELD_WIDTH / 2
  const peak = env.dark ? spec.opacity : spec.opacity / 2

  function place(seconds: number, fade: number): void {
    for (const f of floaters) {
      const i = f.index
      let opacity = 1
      if (spec.layout === 'field') {
        const lane = (i * GOLDEN) % 1
        const speed = (0.18 + ((i * 0.53) % 1) * 0.22) * spec.speed
        const x = ((((( lane - 0.5) * FIELD_WIDTH + seconds * speed + half) % FIELD_WIDTH) + FIELD_WIDTH) % FIELD_WIDTH) - half
        const bob = 0.3 + ((i * 0.29) % 1) * 0.5
        f.mesh.position.set(x, (((i * GOLDEN * 5) % 1) - 0.5) * 14 + Math.sin(seconds * 0.3 + i * 1.7) * bob, -7 - ((i * GOLDEN * 3) % 1) * 16)
        f.mesh.rotation.set(0, (lane - 0.5) * 0.5, (((i * 0.37) % 1) - 0.5) * 0.18)
        opacity = THREE.MathUtils.smoothstep(half - Math.abs(x), 0, 5)
      } else if (spec.layout === 'columns') {
        const lane = i % lanes
        const slot = Math.floor(i / lanes)
        const dir = lane % 2 === 0 ? 1 : -1
        const speed = (0.35 + ((lane * 0.37) % 1) * 0.35) * spec.speed
        const span = 20
        const y = ((((slot / perLane) * span + lane * 1.3 + dir * seconds * speed) % span) + span) % span - span / 2
        f.mesh.position.set(((lane + 0.5) / lanes - 0.5) * FIELD_WIDTH * 0.85, y, -8 - (lane % 3) * 3)
        f.mesh.rotation.set(0, ((lane + 0.5) / lanes - 0.5) * 0.35, 0)
        opacity = THREE.MathUtils.smoothstep(span / 2 - Math.abs(y), 0, 3)
      } else {
        const a = (i / n) * Math.PI * 2 + seconds * 0.06 * spec.speed
        f.mesh.position.set(Math.sin(a) * 17, Math.sin(i * 1.9) * 1.8 + Math.sin(seconds * 0.25 + i) * 0.25, -17 + Math.cos(a) * 9)
        f.mesh.rotation.set(0, a, 0)
        // Cards at the back of the ring recede; the ones passing in front stay quiet so they never compete with the page.
        const front = 0.5 + 0.5 * Math.cos(a)
        opacity = 0.35 + 0.65 * (1 - Math.abs(front - 0.55) * 1.2)
      }
      f.material.uniforms.uOpacity!.value = peak * opacity * fade
    }
  }

  return {
    object: root,
    update: place,
    refresh() {
      for (const f of floaters) f.material.uniforms.uMap!.value = env.bank.textureAt(f.index)
    },
    dispose() {
      geometry.dispose()
      for (const f of floaters) f.material.dispose()
    },
  }
}

// --- one whole scene --------------------------------------------------------------------------

/** Everything a scene is made of, ready to add to a three.js scene. Dispose it when it is replaced. */
export function buildSceneGroup(id: SceneId, env: LayerEnv): SceneGroup {
  const theme = THEMES[id]
  const layers: Layer[] = []
  // Back to front: full-screen effects, then posters, then particles.
  for (const spec of theme.fx) {
    const l = fxLayer(spec, theme, env)
    if (l) layers.push(l)
  }
  layers.push(postersLayer(theme.posters, theme, env))
  for (const spec of theme.particles) {
    const l = particleLayer(spec, theme, env)
    if (l) layers.push(l)
  }
  const root = new THREE.Group()
  for (const l of layers) root.add(l.object)
  return {
    root,
    update(seconds, fade) {
      for (const l of layers) l.update(seconds, fade)
    },
    refresh() {
      for (const l of layers) l.refresh?.()
    },
    dispose() {
      root.removeFromParent()
      for (const l of layers) l.dispose()
    },
  }
}
