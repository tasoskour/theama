/**
 * The show name shared by a set of card titles, to suggest as the series name when grouping them:
 * the longest run of leading words they all have, minus any episode number left dangling at the end.
 * With nothing in common it falls back to the first title.
 */
export function commonTitlePrefix(titles: readonly string[]): string {
  const split = titles.map((t) => t.trim().split(/\s+/).filter(Boolean))
  const first = split[0]
  if (!first) return ''
  let length = first.length
  for (const words of split.slice(1)) {
    let i = 0
    while (i < length && i < words.length && words[i]!.toLowerCase() === first[i]!.toLowerCase()) i++
    length = i
  }
  const shared = first.slice(0, length)
  while (shared.length > 0 && /^(?:\d+|[-–—:,#]+)$/.test(shared[shared.length - 1]!)) shared.pop()
  const prefix = shared.join(' ').replace(/[\s\-–—:,]+$/, '')
  return prefix || first.join(' ')
}
