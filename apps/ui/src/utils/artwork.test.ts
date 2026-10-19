import { describe, expect, it } from 'vitest'
import { columnsFromOffsets, nextGridIndex } from './gridNav'
import { gradientFor, hashString, monogram, paletteFor, titleScale } from './artwork'

describe('artwork', () => {
  it('is deterministic: the same title always looks the same', () => {
    expect(gradientFor('movie:dune:2021')).toBe(gradientFor('movie:dune:2021'))
    expect(paletteFor('x')).toEqual(paletteFor('x'))
  })
  it('spreads different titles over several palettes', () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => paletteFor(`title ${i}`).from))
    expect(seen.size).toBeGreaterThanOrEqual(5)
  })
  it('hashes unicode without throwing', () => {
    expect(hashString('Η Ταινία')).toBeTypeOf('number')
    expect(hashString('')).toBeTypeOf('number')
  })
  it('builds monograms from the first two words, Greek included', () => {
    expect(monogram('The Legend of Vox Machina')).toBe('TL')
    expect(monogram('Interstellar')).toBe('I')
    expect(monogram("X-Men '97")).toBe('XM')
    expect(monogram('ταινία ελληνική')).toBe('ΤΕ')
    expect(monogram('...')).toBe('')
  })
  it('shrinks the title on the poster as it gets longer', () => {
    expect(titleScale('Dune')).toBeGreaterThan(titleScale('The Legend of Vox Machina'))
    expect(titleScale('x'.repeat(80))).toBeLessThan(titleScale('x'.repeat(30)))
  })
})

describe('nextGridIndex (6 columns, 14 cards: two full rows and a row of two)', () => {
  const move = (key: Parameters<typeof nextGridIndex>[0], i: number) => nextGridIndex(key, i, 6, 14)
  it('moves sideways one card at a time and stops at the ends', () => {
    expect(move('ArrowRight', 3)).toBe(4)
    expect(move('ArrowLeft', 3)).toBe(2)
    expect(move('ArrowLeft', 0)).toBe(0)
    expect(move('ArrowRight', 13)).toBe(13)
  })
  it('moves by a row vertically and stays on the first row going up', () => {
    expect(move('ArrowDown', 2)).toBe(8)
    expect(move('ArrowUp', 8)).toBe(2)
    expect(move('ArrowUp', 2)).toBe(2)
  })
  it('lands on the last card when moving down into a short final row', () => {
    expect(move('ArrowDown', 5)).toBe(11)
    expect(move('ArrowDown', 11)).toBe(13) // column 5 does not exist in the last row
    expect(move('ArrowDown', 13)).toBe(13)
    expect(move('ArrowDown', 1)).toBe(7)
  })
  it('supports Home, End and paging', () => {
    expect(move('Home', 9)).toBe(0)
    expect(move('End', 0)).toBe(13)
    expect(move('PageDown', 1)).toBe(13)
    expect(move('PageUp', 13)).toBe(0)
  })
  it('handles degenerate grids', () => {
    expect(nextGridIndex('ArrowDown', 0, 6, 0)).toBe(-1)
    expect(nextGridIndex('ArrowDown', 0, 0, 3)).toBe(1) // zero columns behaves as one
    expect(nextGridIndex('ArrowRight', 0, 6, 1)).toBe(0)
  })
})

describe('columnsFromOffsets', () => {
  it('counts the cards on the first visual row', () => {
    expect(columnsFromOffsets([0, 0, 0, 0, 300, 300])).toBe(4)
    expect(columnsFromOffsets([10, 12, 11, 310])).toBe(3)
    expect(columnsFromOffsets([])).toBe(1)
    expect(columnsFromOffsets([0, 200])).toBe(1)
  })
})
