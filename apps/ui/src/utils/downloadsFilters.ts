import type { GenreMode, MatchKind, Suggestion } from '@theama/contracts'

export interface FindFilters {
  kind?: MatchKind | 'all' | undefined
  years: number[]
  genres: string[]
  genreMode: GenreMode
  ratingRange: number[]
}

/** Missing years/ratings match only when that filter is unrestricted. */
export function matchesFindFilters(item: Suggestion, filters: FindFilters): boolean {
  const [min = 0, max = 10] = filters.ratingRange
  return (!filters.kind || filters.kind === 'all' || item.kind === filters.kind)
    && (filters.years.length === 0 || (item.year !== null && filters.years.includes(item.year)))
    && ((min === 0 && max === 10) || (item.rating !== null && item.rating >= min && item.rating <= max))
    && (filters.genres.length === 0 || (filters.genreMode === 'all'
      ? filters.genres.every((genre) => item.genres?.includes(genre))
      : filters.genres.some((genre) => item.genres?.includes(genre))))
}

/** Many selected years must not flood the provider; preserve input order despite response timing. */
export async function searchFindYears(
  kinds: MatchKind[], years: number[],
  search: (kind: MatchKind, year: number | undefined) => Promise<{ ok: true; items: Suggestion[] } | { ok: false; message: string }>,
  signal: AbortSignal,
): Promise<{ items: Suggestion[] | null; problem: string | null }> {
  const tasks = (years.length ? [...new Set(years)].sort((a, b) => b - a) : [undefined])
    .flatMap((year) => kinds.map((kind) => ({ kind, year })))
  const results: Awaited<ReturnType<typeof search>>[] = new Array(tasks.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (!signal.aborted) {
      const index = cursor++
      const task = tasks[index]
      if (!task) return
      results[index] = await search(task.kind, task.year)
    }
  }))
  const successful = results.filter((result) => result?.ok)
  const seen = new Set<string>()
  const items = successful.length ? successful.flatMap((result) => result.items).filter((item) => {
    const key = `${item.provider}:${item.kind}:${item.externalId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }) : null
  const failure = results.find((result) => result && !result.ok)
  return { items, problem: failure && !failure.ok ? failure.message : null }
}
