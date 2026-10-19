export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown'

/**
 * Where keyboard focus goes next in a wrapping grid of `count` cards laid out `columns` per row.
 * Left/Right move by one and stop at the ends; Up/Down move by a row and stay put on the first/last row;
 * Down from a short last row lands on the final card instead of nowhere. Returns the same index when
 * the move is not possible, so callers can tell "nothing to do" from "moved".
 */
export function nextGridIndex(key: NavKey, index: number, columns: number, count: number): number {
  if (count <= 0) return -1
  const cols = Math.max(1, columns)
  const last = count - 1
  const clamp = (n: number) => Math.min(last, Math.max(0, n))
  switch (key) {
    case 'ArrowLeft':
      return clamp(index - 1)
    case 'ArrowRight':
      return clamp(index + 1)
    case 'ArrowUp':
      return index - cols >= 0 ? index - cols : index
    case 'ArrowDown':
      if (index + cols <= last) return index + cols
      // Partial final row: step down onto its last card if the column does not exist there.
      return Math.floor(index / cols) < Math.floor(last / cols) ? last : index
    case 'Home':
      return 0
    case 'End':
      return last
    case 'PageUp':
      return clamp(index - cols * 3)
    case 'PageDown':
      return clamp(index + cols * 3)
  }
}

/** Number of cards in the first visual row, from each card's top offset. */
export function columnsFromOffsets(tops: readonly number[]): number {
  if (tops.length === 0) return 1
  const first = tops[0]!
  let n = 0
  for (const t of tops) {
    if (Math.abs(t - first) > 4) break
    n++
  }
  return Math.max(1, n)
}
