import type { ExternalLinkRequest } from '@theama/contracts'

/** Builds only the three public destinations the renderer is allowed to open. */
export function externalLinkUrl(link: ExternalLinkRequest): string {
  if (link.service === 'tmdb') {
    const section = link.kind === 'series' ? 'tv' : 'movie'
    return `https://www.themoviedb.org/${section}/${link.id}`
  }
  if (link.service === 'imdb') return `https://www.imdb.com/title/${link.id}/`
  return `https://www.youtube.com/watch?v=${link.id}`
}

/**
 * YouTube refuses to play an embed that arrives without a referrer ("Error 153, video player configuration
 * error"), and a page opened from the app has none. Any https address will do; `.invalid` is reserved, so it
 * can never belong to anyone, and nothing about the person or the library is sent.
 */
export const TRAILER_REFERRER = 'https://theama.invalid/'

/** The privacy-friendlier embed address of a YouTube video, played in Theama's own trailer window. */
export function trailerEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`
}

const TRAILER_HOSTS = ['youtube-nocookie.com', 'youtube.com']

/** The trailer window may only stay on YouTube's own pages; anything else is refused. */
export function isTrailerPageAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && TRAILER_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}
