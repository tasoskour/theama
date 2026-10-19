/** Locale-aware formatting of the technical facts shown next to a file. */

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

export function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  let value = bytes
  let i = 0
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024
    i++
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: BYTE_UNITS[i]!,
    unitDisplay: 'short',
    maximumFractionDigits: i >= 3 ? 1 : 0,
  }).format(value)
}

/** "1h 42m" for long videos, "46m" for episodes, "0m" is shown as "<1m". Returns '' when unknown. */
export function formatDuration(ms: number | null, locale: string): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return ''
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 1) return ms > 0 ? '<1m' : ''
  const unit = (value: number, u: 'hour' | 'minute') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'narrow' }).format(value)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? (minutes > 0 ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}` : unit(hours, 'hour')) : unit(minutes, 'minute')
}

/** "4K", "1080p", "720p"... from the video height (width as a hint for cropped widescreen). */
export function resolutionLabel(width: number | null, height: number | null): string {
  if (!height && !width) return ''
  const h = height ?? 0
  const w = width ?? 0
  if (h >= 2000 || w >= 3600) return '4K'
  if (h >= 1400 || w >= 2500) return '1440p'
  if (h >= 1000 || w >= 1800) return '1080p'
  if (h >= 700 || w >= 1200) return '720p'
  if (h >= 560) return '576p'
  return h ? `${h}p` : ''
}

/** "S02E05", "S02E05–E06", "E12" (no season), or '' when unnumbered. */
export function episodeCode(season: number | null, episode: number | null, episodeEnd: number | null): string {
  if (episode === null) return season === null ? '' : `S${String(season).padStart(2, '0')}`
  const ep = `E${String(episode).padStart(2, '0')}`
  const end = episodeEnd !== null && episodeEnd !== episode ? `–E${String(episodeEnd).padStart(2, '0')}` : ''
  return season === null ? ep + end : `S${String(season).padStart(2, '0')}${ep}${end}`
}
