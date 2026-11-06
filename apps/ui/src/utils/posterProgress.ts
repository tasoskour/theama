import type { DownloadItem } from '@theama/contracts'

/**
 * How far along the unfinished download for this TMDB title is, 0–1; null when there is no such download
 * (not linked, not downloading, or already complete), so the poster is drawn whole.
 */
export function downloadProgressFor(items: readonly DownloadItem[] | undefined, tmdbId: string | null | undefined): number | null {
  if (!tmdbId || !items) return null
  let best: number | null = null
  for (const item of items) {
    if (item.tmdbId !== tmdbId || item.state === 'completed' || item.state === 'error') continue
    const p = clampProgress(item.progress)
    if (p >= 1) continue
    if (best === null || p > best) best = p
  }
  return best
}

export function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
}

/** The width of the full-colour part of a poster, as a CSS percentage (whole numbers, so the edge does not jitter). */
export function fillPercent(progress: number): string {
  return `${Math.floor(clampProgress(progress) * 100)}%`
}
