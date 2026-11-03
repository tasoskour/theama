import type { Release, ReleaseQuery, Resolution } from '@theama/contracts'
import { normaliseTitle } from '../scan/filename'

/** What a raw search hit looks like before it gets an id. */
export type RawRelease = Omit<Release, 'id'>

const SXXEYY = /\bS(\d{1,2})[ ._-]?E(\d{1,3})\b/i
const NXNN = /\b(\d{1,2})x(\d{2,3})\b/i
const SEASON_ONLY = /\bS(\d{1,2})\b(?![ ._-]?E\d)/i
const SEASON_WORD = /\bSeasons?[ ._-]*(\d{1,2})\b/i
const COMPLETE = /\b(?:complete|full[ ._-]?series|all[ ._-]?seasons)\b/i

const SOURCES: [RegExp, string][] = [
  [/\bremux\b/i, 'Remux'],
  [/\bblu[ ._-]?ray\b|\bbd[ ._-]?rip\b|\bbr[ ._-]?rip\b/i, 'BluRay'],
  [/\bweb[ ._-]?dl\b/i, 'WEB-DL'],
  [/\bweb[ ._-]?rip\b|\bweb\b/i, 'WEBRip'],
  [/\bhdtv\b/i, 'HDTV'],
  [/\bdvd[ ._-]?rip\b|\bdvd\b/i, 'DVD'],
  [/\b(?:cam|hdcam|telesync|\bts\b|telecine)\b/i, 'CAM'],
]

const CODECS: [RegExp, string][] = [
  [/\bav1\b/i, 'AV1'],
  [/\bx[ ._-]?265\b|\bh[ ._-]?265\b|\bhevc\b/i, 'HEVC'],
  [/\bx[ ._-]?264\b|\bh[ ._-]?264\b|\bavc\b/i, 'H.264'],
]

function resolutionOf(name: string): Resolution | null {
  if (/\b(?:2160p|4k|uhd)\b/i.test(name)) return '2160p'
  if (/\b1080[pi]\b/i.test(name)) return '1080p'
  if (/\b720p\b/i.test(name)) return '720p'
  if (/\b(?:480p|576p)\b/i.test(name)) return '480p'
  return null
}

const firstMatch = (name: string, table: [RegExp, string][]): string | null => table.find(([re]) => re.test(name))?.[1] ?? null

/** Reads quality, source, codec and season/episode out of a release name. Everything is best-effort; unknowns are null. */
export function parseRelease(name: string): Pick<RawRelease, 'resolution' | 'quality' | 'codec' | 'season' | 'episode' | 'pack'> {
  const sxe = SXXEYY.exec(name) ?? NXNN.exec(name)
  let season: number | null = null
  let episode: number | null = null
  let pack = false
  if (sxe) {
    season = Number(sxe[1])
    episode = Number(sxe[2])
  } else {
    const only = SEASON_ONLY.exec(name) ?? SEASON_WORD.exec(name)
    if (only) {
      season = Number(only[1])
      pack = true
    } else if (COMPLETE.test(name)) {
      pack = true
    }
  }
  return { resolution: resolutionOf(name), quality: firstMatch(name, SOURCES), codec: firstMatch(name, CODECS), season, episode, pack }
}

/**
 * Whether a hit is plausibly the title asked for. Indexers return anything that mentions the words, so the
 * release name has to start with the title (ignoring case, accents and punctuation), and a year, when asked for,
 * must not contradict the one in the name. Episodes and seasons must match when requested.
 */
export function matchesQuery(name: string, parsed: ReturnType<typeof parseRelease>, q: ReleaseQuery): boolean {
  const wanted = normaliseTitle(q.title)
  const have = normaliseTitle(name)
  if (!wanted || !(have === wanted || have.startsWith(`${wanted} `))) return false
  if (q.kind === 'movie') {
    if (parsed.season !== null || parsed.episode !== null) return false
    if (q.year !== undefined) {
      const years = [...name.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]))
      if (years.length > 0 && !years.includes(q.year)) return false
    }
    return true
  }
  if (q.season !== undefined) {
    // A season pack covers any episode of that season; "Complete" packs name no season and cover them all.
    if (parsed.season !== null && parsed.season !== q.season) return false
    if (parsed.season === null && !parsed.pack) return false
    if (q.episode !== undefined && parsed.episode !== null && parsed.episode !== q.episode) return false
  }
  return true
}

/** A name-based hint only: torrent contents are not available until qBittorrent adds it. */
export function isCollectionPack(name: string, collectionName: string): boolean {
  const root = normaliseTitle(collectionName.replace(/\s+collection$/i, ''))
  const normalized = normaliseTitle(name)
  if (!root || !(normalized === root || normalized.startsWith(`${root} `))) return false
  return /\b(?:collection|complete[ ._-]?(?:set|collection|saga|movies|films)|box[ ._-]?set|all[ ._-]?(?:movies|films)|trilogy|quadrilogy|anthology|saga)\b/i.test(name)
    || /\b\d{1,2}\s*[-–]\s*\d{1,2}\b/.test(name)
}

const RESOLUTION_RANK: Record<Resolution, number> = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 }

/** Seeded releases first, then the better resolution; a release nobody is sharing is of little use. */
export function rankReleases<T extends RawRelease>(items: T[], sort: 'quality' | 'seeders' = 'quality'): T[] {
  return [...items].sort((a, b) => {
    if (sort === 'seeders' && a.seeders !== b.seeders) return b.seeders - a.seeders
    const dead = Number(b.seeders > 0) - Number(a.seeders > 0)
    if (dead !== 0) return dead
    const res = (b.resolution ? RESOLUTION_RANK[b.resolution] : 0) - (a.resolution ? RESOLUTION_RANK[a.resolution] : 0)
    return res !== 0 ? res : b.seeders - a.seeders || a.title.localeCompare(b.title)
  })
}
