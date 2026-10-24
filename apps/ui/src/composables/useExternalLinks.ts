import type { ExternalLinkRequest } from '@theama/contracts'

/** The desktop app can play a trailer inside the page; a browser tab can only link to YouTube. */
export const trailerInApp = typeof window !== 'undefined' && window.theama !== undefined

export function externalUrl(link: ExternalLinkRequest): string {
  if (link.service === 'tmdb') return `https://www.themoviedb.org/${link.kind === 'series' ? 'tv' : 'movie'}/${link.id}`
  if (link.service === 'imdb') return `https://www.imdb.com/title/${link.id}/`
  if (link.service === 'opensubtitles') return 'https://www.opensubtitles.com/en/consumers'
  if (link.service === 'subdl') return 'https://subdl.com/panel/api'
  return `https://www.youtube.com/watch?v=${link.id}`
}

/** The link for an IMDb id, or null when it is missing or not shaped like one. */
export const imdbLinkFor = (id: string | null | undefined): ExternalLinkRequest | null => (id && /^tt\d{5,12}$/.test(id) ? { service: 'imdb', id } : null)

/** Opens a link in the user's browser: through the desktop app when there is one, in a new tab otherwise. */
export async function openExternal(link: ExternalLinkRequest): Promise<void> {
  if (window.theama) await window.theama.openExternal(link)
  else window.open(externalUrl(link), '_blank', 'noopener,noreferrer')
}
