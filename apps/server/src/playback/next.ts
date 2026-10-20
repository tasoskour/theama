import type { NextEpisode } from '@theama/contracts'

/** What the next-episode rule needs to know about one file of a series. */
export interface EpisodeFile {
  id: number
  season: number | null
  episode: number | null
  watched: boolean
  /** Where playback stopped last time (seconds), if it was worth remembering. */
  positionSeconds: number | null
  /** Its folder is online and the file is present. */
  available: boolean
}

export const episodeLabel = (season: number, episode: number): string =>
  `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`

/**
 * The episode to offer as "next": the first unwatched local episode after the last one watched, or the very
 * first episode when nothing has been watched. Specials (season 0) and files without a number are left out,
 * episodes the library lacks are skipped (there is nothing to play), and an episode counts as watched when
 * any of its files is. Returns null when the person has caught up with everything they have.
 */
export function nextEpisode(files: readonly EpisodeFile[]): NextEpisode | null {
  const groups = new Map<number, { season: number; episode: number; watched: boolean; files: EpisodeFile[] }>()
  for (const f of files) {
    if (f.season === null || f.episode === null || f.season <= 0) continue
    const k = f.season * 100_000 + f.episode
    const g = groups.get(k) ?? { season: f.season, episode: f.episode, watched: false, files: [] }
    g.watched ||= f.watched
    g.files.push(f)
    groups.set(k, g)
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g)
  let lastWatched = -1
  ordered.forEach((g, i) => {
    if (g.watched) lastWatched = i
  })
  const next = ordered.slice(lastWatched + 1).find((g) => !g.watched)
  if (!next) return null
  const file = next.files.find((f) => f.available) ?? next.files[0]!
  const resumeSeconds = file.positionSeconds ?? next.files.find((f) => f.positionSeconds !== null)?.positionSeconds ?? null
  return { fileId: file.id, season: next.season, episode: next.episode, label: episodeLabel(next.season, next.episode), resumeSeconds }
}

/** The columns the rule reads from the database, as one row. */
export interface EpisodeFileRow {
  id: number
  season: number | null
  episode: number | null
  watched: number | null
  position_seconds?: number | null
  state: 'available' | 'missing_unconfirmed'
  availability: 'online' | 'offline' | 'unknown'
}

export const toEpisodeFile = (r: EpisodeFileRow): EpisodeFile => ({
  id: r.id,
  season: r.season,
  episode: r.episode,
  watched: r.watched === 1,
  positionSeconds: r.watched === 1 ? null : (r.position_seconds ?? null),
  available: r.state === 'available' && r.availability !== 'offline',
})

