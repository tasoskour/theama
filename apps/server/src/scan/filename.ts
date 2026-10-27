import type { LibraryType, MediaKind } from '@theama/contracts'

export interface ParsedMedia {
  kind: MediaKind
  /** Movie title, series title, or the personal video's own name. Never fetched from a database. */
  title: string
  year: number | null
  season: number | null
  episode: number | null
  episodeEnd: number | null
  episodeTitle: string | null
}

/** Video container extensions recognised by default (lower case, with the dot). */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.mpg', '.mpeg', '.ts', '.webm',
])

export function isVideoFileName(name: string, extensions: ReadonlySet<string> = VIDEO_EXTENSIONS): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && extensions.has(name.slice(dot).toLowerCase())
}

// ---------------------------------------------------------------------------
// Patterns. They run on a cleaned name where '.' and '_' have become spaces.
// ---------------------------------------------------------------------------

/** S01E02, S01E02E03, S01E02-E03, S01E02-03 (but not "S01E02 1080p" or "S01E02-1080p"). */
const SXXEYY = /\bS(\d{1,2})[ -]?E(\d{1,3})(?:[ -]?(?:E|-E?)(\d{1,3}))?(?!\d)/i
const NXNN = /\b(\d{1,2})x(\d{2,3})\b/i
/** A season-only marker such as "S02" in a season pack. */
const SEASON_ONLY = /\bS(\d{1,2})\b(?![ -]?E\d)/i
/** "Season 1", but not the range form "Seasons 1 and 2". */
const SEASON_WORD = /\bSeason[ -]*(\d{1,2})\b(?!\s*(?:and|&|,|-))/i
/** Anime-style absolute numbering: "Mushishi 01 - The Green Seat". */
const ABSOLUTE = /^(.+?)\s+(\d{1,3})(?:v\d)?\s+-\s+(.+)$/
/** "01 - Title" inside a Season folder. */
const LEADING_NUMBER = /^(\d{1,3})\s*[-.]\s*(.+)$/
/** "第7話" (group 1), "Episode 7" / "Ep.7" (group 2) or "#7" (group 3). Season-less, so the number is absolute. */
const EPISODE_WORD = /第\s*(\d{1,4})\s*[話话回]|\b(?:episode|ep)[ .#-]*(\d{1,4})\b|#(\d{1,4})\b/i
/** "Title 007" or "Title 007 Episode title" in a series folder, where nothing else numbers the episode. */
const BARE_NUMBER = /^(.+?)\s+0*(\d{1,3})(?:v\d)?(?:\s+(.+))?$/
/** What precedes a "第7話" marker when the show name is followed by its number: "Title 007 ちびまる子ちゃん". */
const NUMBER_THEN_NAME = /^(.+?)\s+0*\d{1,4}\s+(.+)$/
/** Trailing " - dQw4w9WgXcQ" left by a downloader. Needs a digit and a letter, so a real word is never taken for one. */
const VIDEO_ID_SUFFIX = /\s+-\s*(?=[\w-]{11}\s*$)(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{11}\s*$/

/** Quality, source, codec and release flags: everything after these is not part of the title. */
const NOISE =
  /\b(?:\d{3,4}p|\d{3,4} ?x ?\d{3,4}|4k|uhd|blu[ -]?ray|bd[ -]?rip|br[ -]?rip|web[ -]?dl|web[ -]?rip|hdtv|dvd[ -]?rip|hd[ -]?rip|remux|x ?26[45]|h ?26[45]|hevc|avc|xvid|divx|10 ?bit|repack|internal|extended|unrated|remastered|uncut|multi[ -]?subs?|dual audio)\b/i

const EXTRA_FOLDER =
  /^(?:featurettes?|extras?|behind the scenes|deleted scenes?|trailers?|samples?|interviews?|shorts|scenes|bonus(?: features?)?|making of)$/i
/** A file that *is* a sample/trailer ("sample.mkv", "Movie-sample.mkv"), not a title that merely starts with the word. */
const EXTRA_FILE = /^(?:sample|trailer)$|[ ._-](?:sample|trailer)$/i
const SEASON_FOLDER = /^(?:season|series|staffel|saison|temporada|s)[ ._-]*(\d{1,2})$/i
const SPECIALS_FOLDER = /^specials?$/i
/** Folder names that say nothing about the title. */
const GENERIC_FOLDER =
  /^(?:movies?|films?|series|tv(?:[ ._-]?shows?)?|shows?|videos?|anime|downloads?|media|subs?|subtitles?|specials?|(?:season|s)[ ._-]*\d{1,2}|(?:disc|cd) ?\d+|video_ts)$/i

interface Analysis {
  title: string
  year: number | null
  season: number | null
  episode: number | null
  episodeEnd: number | null
  episodeTitle: string | null
  /** SxxEyy, NxNN or absolute numbering was found. */
  hasEpisodeMarker: boolean
  /** A year, resolution, source or codec tag was found (typical of released movies). */
  hasReleaseSignals: boolean
  /** The episode number stands alone ("Title 01 - ...", "第7話"): it counts from the start of the show, with no season. */
  absolute: boolean
}

function stripDecorations(raw: string): { text: string; parenYear: number | null } {
  let s = raw.normalize('NFC')
  // "www.UIndex.org - Show ..." site prefixes
  s = s.replace(/^\s*(?:www\.)?[a-z0-9-]+\.(?:org|com|net|to|re|me|cc|tv)\s+-+\s+/i, '')
  const paren = /\(((?:19|20)\d{2})\)/.exec(s)
  const parenYear = paren ? Number(paren[1]) : null
  s = s.replace(/\[[^\]]*\]/g, ' ') // [group], [BD], [eztv.re], [KOREAN]
  s = s.replace(/\((?!(?:19|20)\d{2}\))[^)]*\)/g, ' ') // (1080p BluRay x265), (Season 1), but keep (2020)
  s = s.replace(/\(((?:19|20)\d{2})\)/g, ' $1 ')
  s = s.replace(/[（【][^）】]*[）】]/g, ' ') // full-width brackets, as in （英語字幕付き）
  s = s.replace(VIDEO_ID_SUFFIX, '')
  s = s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim()
  return { text: s, parenYear }
}

const trimSeparators = (s: string): string => s.replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, '').replace(/\s+/g, ' ')

/** Pulls the title, year and episode numbering out of one name (a file name or a folder name). */
function analyse(raw: string): Analysis {
  const { text, parenYear } = stripDecorations(raw)

  let season: number | null = null
  let episode: number | null = null
  let episodeEnd: number | null = null
  let markerStart = -1
  let markerEnd = -1
  let hasEpisodeMarker = false
  let absolute = false
  let nativeMarker = false

  const sxe = SXXEYY.exec(text)
  const nxn = sxe ? null : NXNN.exec(text)
  const word = sxe || nxn ? null : EPISODE_WORD.exec(text)
  if (sxe) {
    season = Number(sxe[1])
    episode = Number(sxe[2])
    episodeEnd = sxe[3] ? Number(sxe[3]) : null
    markerStart = sxe.index
    markerEnd = sxe.index + sxe[0].length
    hasEpisodeMarker = true
  } else if (nxn) {
    season = Number(nxn[1])
    episode = Number(nxn[2])
    markerStart = nxn.index
    markerEnd = nxn.index + nxn[0].length
    hasEpisodeMarker = true
  } else if (word) {
    episode = Number(word[1] ?? word[2] ?? word[3])
    markerStart = word.index
    markerEnd = word.index + word[0].length
    hasEpisodeMarker = true
    absolute = true
    nativeMarker = word[1] !== undefined
  } else {
    const only = SEASON_ONLY.exec(text) ?? SEASON_WORD.exec(text)
    if (only) {
      season = Number(only[1])
      markerStart = only.index
      markerEnd = only.index + only[0].length
    }
  }

  const noise = NOISE.exec(text)
  const noiseStart = noise ? noise.index : text.length
  const regionEnd = Math.min(markerStart >= 0 ? markerStart : text.length, noiseStart)
  let region = text.slice(0, regionEnd)
  let episodeTitle: string | null = null

  if (episode !== null) {
    const after = trimSeparators(text.slice(markerEnd, noiseStart > markerEnd ? noiseStart : text.length))
    episodeTitle = after || null
    // "Show 007 ちびまる子ちゃん 第7話": the number and the native name before the marker are the show and the episode name.
    const split = nativeMarker ? NUMBER_THEN_NAME.exec(region) : null
    if (split) {
      region = split[1]!
      episodeTitle = trimSeparators([split[2], after].filter(Boolean).join(' ')) || null
    }
  } else if (markerStart < 0) {
    // No SxxEyy / NxNN: try anime-style "Title 01 - Episode Title".
    const abs = ABSOLUTE.exec(text.slice(0, noiseStart))
    if (abs && !/^(?:19|20)\d{2}$/.test(abs[2]!)) {
      region = abs[1]!
      episode = Number(abs[2])
      episodeTitle = trimSeparators(abs[3]!) || null
      hasEpisodeMarker = true
      absolute = true
    }
  }

  // Year: the last year-looking token that is not the very first word, preferring "(2017)".
  let year: number | null = null
  const yearTokens = [...region.matchAll(/\b((?:19|20)\d{2})\b/g)].filter((m) => m.index > 0)
  if (yearTokens.length > 0) {
    const preferred = yearTokens.find((m) => Number(m[1]) === parenYear) ?? yearTokens[yearTokens.length - 1]!
    year = Number(preferred[1])
    region = region.slice(0, preferred.index) + ' ' + region.slice(preferred.index! + 4)
  }

  return {
    title: trimSeparators(region),
    year,
    season,
    episode,
    episodeEnd,
    episodeTitle,
    hasEpisodeMarker,
    hasReleaseSignals: year !== null || noise !== null,
    absolute,
  }
}

/**
 * Lower-case, accent-free, punctuation-free form of a title. Used to group titles ("X-Men '97" and "x-men 97"
 * match) and to build the search index, so it must fold Greek too: tonos and diaeresis are removed (NFD marks)
 * and the final sigma "ς" becomes "σ" so "ταινιες" finds "Ταινίες".
 */
export function normaliseTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Identity of the *title* a file belongs to, derived from its name until Phase 4 matches
 * files to real titles: all episodes of a show share a key, a movie is title + year,
 * and every personal video or extra stands alone.
 */
export function titleKeyFor(kind: MediaKind, title: string, year: number | null, path: string): string {
  switch (kind) {
    case 'movie':
      return `movie:${normaliseTitle(title)}:${year ?? ''}`
    case 'episode':
      return `series:${normaliseTitle(title)}`
    case 'video':
      return `video:${path.toLowerCase()}`
    case 'extra':
      return `extra:${path.toLowerCase()}`
  }
}

/** A person's series name for a file: it replaces the parsed show title, so every file given the same name groups together. */
export function applyTitleOverride(parsed: ParsedMedia, titleOverride: string | null | undefined): ParsedMedia {
  return titleOverride && parsed.kind === 'episode' ? { ...parsed, title: titleOverride } : parsed
}

function isGeneric(folder: string): boolean {
  return GENERIC_FOLDER.test(folder.trim())
}

/**
 * Interprets a file's location. `segments` are the folder names from the source
 * root (including the root's own name) followed by the file name.
 *
 * Rules (see docs/07 and docs/08):
 *  - the user's folder type wins: "My Videos" is never interpreted, "Movies" is always movies, "Series" always episodes;
 *  - in an "Auto-detect" folder an episode pattern means series, a year or release tags mean movie,
 *    and anything else is treated as a personal video (never forced into a movie match);
 *  - featurettes/samples/trailers are kept but marked as extras;
 *  - a missing title or season is taken from the nearest meaningful parent folder.
 */
export function parseMediaPath(segments: readonly string[], sourceType: LibraryType): ParsedMedia {
  const fileName = segments[segments.length - 1] ?? ''
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 && fileName.length - dot <= 6 ? fileName.slice(0, dot) : fileName
  const folders = segments.slice(0, -1).map((s) => s.trim()).filter(Boolean)

  const empty = { year: null, season: null, episode: null, episodeEnd: null, episodeTitle: null }

  if (folders.some((f) => EXTRA_FOLDER.test(f)) || EXTRA_FILE.test(base)) {
    const a = analyse(base)
    return { kind: 'extra', ...empty, title: a.title || base }
  }
  if (sourceType === 'videos') {
    return { kind: 'video', ...empty, title: base.trim() }
  }

  const a = analyse(base)
  let { title, year, season } = a
  let { episode } = a
  let episodeTitle = a.episodeTitle

  const nearestFirst = [...folders].reverse()

  // Season from "Season 02" / "Specials" folders or an "S02" season-pack folder.
  const inferSeason = (): number | null => {
    for (const f of nearestFirst) {
      const m = SEASON_FOLDER.exec(f)
      if (m) return Number(m[1])
      if (SPECIALS_FOLDER.test(f)) return 0
    }
    for (const f of nearestFirst) {
      const fa = analyse(f)
      if (fa.season !== null && !fa.hasEpisodeMarker) return fa.season
    }
    return null
  }
  const seasonFolder = nearestFirst.some((f) => SEASON_FOLDER.test(f) || SPECIALS_FOLDER.test(f))

  // "01 - Episode title" with no show name: only meaningful inside a series-like context.
  if (episode === null && !a.hasEpisodeMarker && sourceType !== 'movies' && (sourceType === 'series' || seasonFolder)) {
    const lead = LEADING_NUMBER.exec(stripDecorations(base).text)
    if (lead) {
      episode = Number(lead[1])
      episodeTitle = trimSeparators(lead[2]!) || null
      title = ''
    }
  }

  // Title from the nearest meaningful folder when the file name has none.
  const titleFromName = title !== ''
  if (!title) {
    title = ''
    for (const f of nearestFirst) {
      if (isGeneric(f)) continue
      const fa = analyse(f)
      if (fa.title && !isGeneric(fa.title)) {
        title = fa.title
        year ??= fa.year
        break
      }
    }
  }
  if (!title) title = trimSeparators(stripDecorations(base).text) || base

  // "Show 007" or "Show 007 Episode name" in a series folder: the trailing number is the episode.
  let absolute = a.absolute
  if (episode === null && !a.hasEpisodeMarker && sourceType === 'series' && titleFromName) {
    const bare = BARE_NUMBER.exec(title)
    if (bare) {
      title = trimSeparators(bare[1]!)
      episode = Number(bare[2])
      episodeTitle = trimSeparators(bare[3] ?? '') || null
      absolute = true
    }
  }

  if (season === null && (episode !== null || a.hasEpisodeMarker)) season = inferSeason()
  // A number that counts from the start of the show has no season of its own: it is season 1.
  if (season === null && absolute && episode !== null) season = 1

  const hasEpisodeInfo = a.hasEpisodeMarker || episode !== null
  let kind: MediaKind
  if (sourceType === 'series') kind = 'episode'
  else if (sourceType === 'movies') kind = 'movie'
  else if (hasEpisodeInfo) kind = 'episode'
  else if (a.hasReleaseSignals) kind = 'movie'
  else kind = 'video'

  if (kind !== 'episode') {
    return { kind, title, year, season: null, episode: null, episodeEnd: null, episodeTitle: null }
  }
  return { kind, title, year, season, episode, episodeEnd: a.episodeEnd, episodeTitle }
}
