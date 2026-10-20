import { describe, expect, it } from 'vitest'
import { episodeCode, formatBytes, formatClock, formatDuration, resolutionLabel } from './format'

describe('formatClock', () => {
  it('shows minutes and seconds, adding hours from the first hour', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(754)).toBe('12:34')
    expect(formatClock(3723.9)).toBe('1:02:03')
  })
  it('returns nothing for nonsense', () => {
    expect(formatClock(null)).toBe('')
    expect(formatClock(-3)).toBe('')
    expect(formatClock(NaN)).toBe('')
  })
})

describe('formatBytes', () => {
  it('picks a sensible unit', () => {
    expect(formatBytes(512, 'en')).toMatch(/^512 (B|bytes?)$/)
    expect(formatBytes(1566 * 1048576, 'en')).toMatch(/^1\.5 GB$/)
    expect(formatBytes(700 * 1048576, 'en')).toMatch(/^700 MB$/)
  })
  it('uses the locale\'s number format', () => {
    expect(formatBytes(1566 * 1048576, 'el')).toContain('1,5')
  })
  it('returns nothing for nonsense', () => {
    expect(formatBytes(-1, 'en')).toBe('')
    expect(formatBytes(NaN, 'en')).toBe('')
  })
})

describe('formatDuration', () => {
  it('shows hours and minutes for movies and minutes for episodes', () => {
    expect(formatDuration(102 * 60_000, 'en')).toBe('1h 42m')
    expect(formatDuration(120 * 60_000, 'en')).toBe('2h')
    expect(formatDuration(2754321, 'en')).toBe('46m')
  })
  it('handles unknown and tiny durations', () => {
    expect(formatDuration(null, 'en')).toBe('')
    expect(formatDuration(0, 'en')).toBe('')
    expect(formatDuration(20_000, 'en')).toBe('<1m')
  })
  it('localises the unit symbols', () => {
    expect(formatDuration(102 * 60_000, 'el')).not.toBe(formatDuration(102 * 60_000, 'en'))
  })
})

describe('resolutionLabel', () => {
  it.each([
    [3840, 2160, '4K'],
    [1920, 1080, '1080p'],
    [1920, 800, '1080p'], // cropped widescreen is still 1080p-class
    [1280, 720, '720p'],
    [720, 576, '576p'],
    [640, 360, '360p'],
    [null, null, ''],
  ])('%s x %s -> %s', (w, h, label) => {
    expect(resolutionLabel(w, h)).toBe(label)
  })
})

describe('episodeCode', () => {
  it('formats season/episode numbering', () => {
    expect(episodeCode(1, 2, null)).toBe('S01E02')
    expect(episodeCode(2, 3, 4)).toBe('S02E03–E04')
    expect(episodeCode(null, 12, null)).toBe('E12')
    expect(episodeCode(3, null, null)).toBe('S03')
    expect(episodeCode(null, null, null)).toBe('')
  })
})
