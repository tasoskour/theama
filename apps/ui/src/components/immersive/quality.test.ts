import { describe, expect, it } from 'vitest'
import { PROFILES, SAMPLE_FRAMES, SLOW_FRAME_MS, fxAllowed, isStruggling, pixelRatioFor, slowLimitFor, stepDown } from './quality'

describe('quality profiles', () => {
  it('asks for more at each level', () => {
    expect(PROFILES.low.particles).toBeLessThan(PROFILES.medium.particles)
    expect(PROFILES.medium.particles).toBeLessThan(PROFILES.high.particles)
    expect(PROFILES.low.posterPlanes).toBeLessThan(PROFILES.high.posterPlanes)
  })

  it('caps the pixel ratio and never goes below 1', () => {
    expect(pixelRatioFor(PROFILES.low, 3)).toBe(1)
    expect(pixelRatioFor(PROFILES.high, 3)).toBe(2)
    expect(pixelRatioFor(PROFILES.high, 1.25)).toBe(1.25)
    expect(pixelRatioFor(PROFILES.high, 0)).toBe(1)
  })

  it('steps down one level at a time and stops at low', () => {
    expect(stepDown('high')).toBe('medium')
    expect(stepDown('medium')).toBe('low')
    expect(stepDown('low')).toBeNull()
  })
})

describe('fxAllowed', () => {
  it('drops the costly full-screen effects on Low, but keeps the cheap vignette', () => {
    for (const fx of ['aurora', 'nebula', 'fog', 'grid'] as const) {
      expect(fxAllowed(fx, PROFILES.low)).toBe(false)
      expect(fxAllowed(fx, PROFILES.medium)).toBe(true)
      expect(fxAllowed(fx, PROFILES.high)).toBe(true)
    }
    expect(fxAllowed('flicker', PROFILES.low)).toBe(true)
  })
  it('follows the light-shaft switch for shafts', () => {
    expect(fxAllowed('shafts', PROFILES.low)).toBe(false)
    expect(fxAllowed('shafts', PROFILES.medium)).toBe(true)
  })
})

describe('isStruggling', () => {
  it('waits for a full sample', () => {
    expect(isStruggling(Array(SAMPLE_FRAMES - 1).fill(100))).toBe(false)
  })
  it('flags sustained slow frames', () => {
    expect(isStruggling(Array(SAMPLE_FRAMES).fill(40))).toBe(true)
  })
  it('does not mistake a deliberate frame-rate cap for slowness', () => {
    const capped = Array<number>(SAMPLE_FRAMES).fill(1000 / 30)
    expect(isStruggling(capped)).toBe(true)
    expect(isStruggling(capped, slowLimitFor(PROFILES.low))).toBe(false)
    expect(slowLimitFor(PROFILES.high)).toBe(SLOW_FRAME_MS)
  })
  it('ignores a few hitches', () => {
    const frames = Array<number>(SAMPLE_FRAMES).fill(16)
    for (let i = 0; i < 5; i++) frames[i] = 200
    expect(isStruggling(frames)).toBe(false)
  })
})
