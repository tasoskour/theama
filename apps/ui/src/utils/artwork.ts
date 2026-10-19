/**
 * Generated poster artwork for titles that have no real artwork yet (every title, until metadata
 * matching arrives). Deterministic: the same title always gets the same look, so a library stays
 * recognisable between launches. Palettes are muted bronze / ink / verdigris / oxblood tones that
 * sit well on both themes.
 */

export interface PosterPalette {
  /** Top-left colour of the diagonal gradient. */
  from: string
  /** Bottom-right colour. */
  to: string
  /** Thin accent used for the rule and the year. */
  accent: string
}

const PALETTES: readonly PosterPalette[] = [
  { from: '#3A2F1F', to: '#16120C', accent: '#D9B87A' }, // bronze
  { from: '#1F3A3A', to: '#0B1717', accent: '#8FC4B8' }, // verdigris
  { from: '#4A2323', to: '#190C0C', accent: '#E0A08A' }, // oxblood
  { from: '#2B2F4A', to: '#0E1020', accent: '#A9B4E8' }, // ink blue
  { from: '#3B3A24', to: '#15150B', accent: '#CFC77A' }, // olive
  { from: '#43302F', to: '#170F0F', accent: '#D8A9A0' }, // clay
  { from: '#2A3D2C', to: '#0D170E', accent: '#9FCB9A' }, // pine
  { from: '#38283F', to: '#130C17', accent: '#C9A3D8' }, // plum
]

/** FNV-1a: small, fast, and good enough to spread titles over a handful of palettes. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function paletteFor(seed: string): PosterPalette {
  return PALETTES[hashString(seed) % PALETTES.length]!
}

/** A CSS gradient for the poster; the angle also varies a little per title. */
export function gradientFor(seed: string): string {
  const p = paletteFor(seed)
  const angle = 140 + (hashString(seed + '#') % 40)
  return `linear-gradient(${angle}deg, ${p.from} 0%, ${p.to} 100%)`
}

/** Up to two capital letters for a monogram (first letters of the first two words that start with a letter or digit). */
export function monogram(title: string): string {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const letters = words.slice(0, 2).map((w) => [...w][0]!.toLocaleUpperCase())
  return letters.join('')
}

/** Font size (as a fraction of the card width) for the title on the poster, shrinking for long titles. */
export function titleScale(title: string): number {
  const n = [...title].length
  if (n <= 12) return 0.15
  if (n <= 24) return 0.12
  if (n <= 40) return 0.1
  return 0.085
}
