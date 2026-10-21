import { describe, expect, it } from 'vitest'
import { SCENE_IDS } from '@theama/contracts'
import en from '@/i18n/locales/en.json'
import el from '@/i18n/locales/el.json'
import { THEMES } from './themes'

type Scenes = Record<string, { name: string; hint: string }>
const names = (tree: unknown): Scenes => (tree as { settings: { backdrop: { scenes: Scenes } } }).settings.backdrop.scenes

describe('scene catalogue', () => {
  it('has a theme for every scene id, filed under its own id', () => {
    for (const id of SCENE_IDS) expect(THEMES[id]?.id, id).toBe(id)
    expect(Object.keys(THEMES).sort()).toEqual([...SCENE_IDS].sort())
  })

  it('has a name and a description in both languages for every scene', () => {
    for (const tree of [en, el]) {
      for (const id of SCENE_IDS) {
        expect(names(tree)[id]?.name?.trim(), id).toBeTruthy()
        expect(names(tree)[id]?.hint?.trim(), id).toBeTruthy()
      }
    }
  })

  it('keeps the original backdrop as the only scene tinted by the route', () => {
    expect(THEMES.classic.followsRoute).toBe(true)
    for (const id of SCENE_IDS.filter((s) => s !== 'classic')) expect(THEMES[id].followsRoute, id).toBe(false)
  })

  it('reproduces the original backdrop exactly for classic', () => {
    const t = THEMES.classic
    expect(t.particles).toEqual([{ mode: 'drift', shape: 'dot', count: 1, size: 5, alpha: 0.9, alphaLight: 0.5, speed: 1, twinkle: 1 }])
    expect(t.fx).toEqual([{ fx: 'shafts', strength: 1 }])
    expect(t.posters).toEqual({ layout: 'field', count: 1, opacity: 0.3, blur: 3.2, tint: 0.18, speed: 1 })
  })

  it('uses valid colours and sane numbers everywhere', () => {
    for (const t of Object.values(THEMES)) {
      for (const c of [t.accent, t.accent2, t.accent3]) expect(c, t.id).toMatch(/^#[0-9A-Fa-f]{6}$/)
      for (const p of t.particles) {
        expect(p.count, t.id).toBeGreaterThan(0)
        expect(p.size, t.id).toBeGreaterThan(0)
        expect(p.alpha, t.id).toBeGreaterThan(0)
        expect(p.alpha, t.id).toBeLessThanOrEqual(1)
      }
      expect(t.posters.opacity, t.id).toBeGreaterThan(0)
      expect(t.posters.opacity, t.id).toBeLessThan(1)
    }
  })

  it('gives the kind scenes the layouts that tell them apart', () => {
    expect(THEMES.movie.posters.layout).toBe('ring')
    expect(THEMES.series.posters.layout).toBe('columns')
  })
})
