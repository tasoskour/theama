import { normaliseTitle } from './filename'

/**
 * Turns what a person typed into an FTS5 query: every word is folded the same way the index is
 * (case, accents incl. Greek tonos, final sigma), becomes a quoted prefix term ("sev" finds Severance),
 * and all of them must match. Returns null when nothing searchable was typed.
 */
export function ftsQuery(input: string): string | null {
  const words = input
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .map((w) => normaliseTitle(w))
    .filter(Boolean)
    .slice(0, 8)
  return words.length === 0 ? null : words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ')
}
