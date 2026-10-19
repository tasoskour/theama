import type { EpisodeInfo, SeasonCoverage, SeriesCoverage } from '@theama/contracts'
import type { StoredEpisode } from '../metadata/store'

/** The parts of a file that decide which episodes it covers. */
export interface CoverageFile {
  id: number
  season: number | null
  episode: number | null
  episodeEnd: number | null
}

/** The longest run an `E01-E99` style range may cover; anything longer is a mis-parse, not a real file. */
const MAX_RANGE = 40

function covered(f: CoverageFile): number[] {
  if (f.season === null || f.episode === null) return []
  const last = Math.min(f.episodeEnd ?? f.episode, f.episode + MAX_RANGE)
  const out: number[] = []
  for (let n = f.episode; n <= Math.max(last, f.episode); n++) out.push(n)
  return out
}

/**
 * Lines up the provider's episode list with the files on disk:
 * - an episode with a file is *local* (several files = duplicates or versions);
 * - one without is *missing* if it has aired, *upcoming* if it has not, *undated* if the provider gives no date;
 * - a file whose season/episode the provider does not list, or that has no number, is *unmatched* and stays visible.
 * `today` is a `YYYY-MM-DD` date; an episode airing today counts as aired.
 */
export function buildCoverage(
  provider: readonly StoredEpisode[],
  files: readonly CoverageFile[],
  today: string,
): { episodes: EpisodeInfo[]; coverage: SeriesCoverage } {
  const filesByEpisode = new Map<string, number[]>()
  const known = new Set(provider.map((e) => `${e.season}:${e.episode}`))
  const unmatched: number[] = []
  const strays = new Map<number, Set<number>>() // season -> file ids with numbers the provider lacks

  for (const f of files) {
    const numbers = covered(f)
    if (numbers.length === 0) {
      unmatched.push(f.id)
      continue
    }
    let stray = false
    for (const n of numbers) {
      const k = `${f.season}:${n}`
      if (known.has(k)) filesByEpisode.set(k, [...(filesByEpisode.get(k) ?? []), f.id])
      else stray = true
    }
    if (stray) {
      unmatched.push(f.id)
      const set = strays.get(f.season!) ?? new Set<number>()
      set.add(f.id)
      strays.set(f.season!, set)
    }
  }

  const episodes: EpisodeInfo[] = provider.map((e) => {
    const fileIds = [...new Set(filesByEpisode.get(`${e.season}:${e.episode}`) ?? [])]
    const status =
      fileIds.length > 0 ? 'local' : e.airDate === null ? 'undated' : e.airDate > today ? 'upcoming' : 'missing'
    return { ...e, status, fileIds }
  })

  const seasons = new Map<number, SeasonCoverage>()
  const seasonOf = (n: number): SeasonCoverage => {
    let s = seasons.get(n)
    if (!s) {
      s = { season: n, expected: 0, local: 0, missing: 0, upcoming: 0, undated: 0, notInProvider: 0, duplicates: 0 }
      seasons.set(n, s)
    }
    return s
  }
  for (const e of episodes) {
    const s = seasonOf(e.season)
    s.expected++
    s[e.status]++
    if (e.fileIds.length > 1) s.duplicates++
  }
  for (const [season, ids] of strays) seasonOf(season).notInProvider = ids.size

  return {
    episodes,
    coverage: { seasons: [...seasons.values()].sort((a, b) => a.season - b.season), unmatchedFileIds: [...new Set(unmatched)] },
  }
}
