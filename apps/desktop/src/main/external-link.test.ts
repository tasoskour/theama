import { describe, expect, it } from 'vitest'
import { ExternalLinkRequest, SETUP_RESOURCES } from '@theama/contracts'
import { externalLinkUrl, isTrailerPageAllowed, TRAILER_REFERRER, trailerEmbedUrl } from './external-link'

describe('externalLinkUrl', () => {
  it('opens only the fixed setup resources', () => {
    for (const [resource, url] of Object.entries(SETUP_RESOURCES)) {
      expect(externalLinkUrl(ExternalLinkRequest.parse({ service: 'setup', resource }))).toBe(url)
    }
    expect(() => ExternalLinkRequest.parse({ service: 'setup', resource: 'file:///C:/secret' })).toThrow()
    expect(() => ExternalLinkRequest.parse({ service: 'setup', resource: 'https://example.com' })).toThrow()
  })
  it('builds canonical provider and trailer links', () => {
    expect(externalLinkUrl(ExternalLinkRequest.parse({ service: 'tmdb', kind: 'movie', id: '157336' }))).toBe(
      'https://www.themoviedb.org/movie/157336',
    )
    expect(externalLinkUrl(ExternalLinkRequest.parse({ service: 'tmdb', kind: 'series', id: '95396' }))).toBe(
      'https://www.themoviedb.org/tv/95396',
    )
    expect(externalLinkUrl(ExternalLinkRequest.parse({ service: 'imdb', id: 'tt11280740' }))).toBe(
      'https://www.imdb.com/title/tt11280740/',
    )
    expect(externalLinkUrl(ExternalLinkRequest.parse({ service: 'youtube', id: 'zSWdZVtXT7E' }))).toBe(
      'https://www.youtube.com/watch?v=zSWdZVtXT7E',
    )
  })

  it('plays trailers from the privacy-friendly embed address', () => {
    expect(trailerEmbedUrl('zSWdZVtXT7E')).toBe('https://www.youtube-nocookie.com/embed/zSWdZVtXT7E?autoplay=1&rel=0&playsinline=1')
  })

  it('opens only the fixed subtitle-provider setup destinations', () => {
    expect(externalLinkUrl(ExternalLinkRequest.parse({ service: 'opensubtitles' }))).toBe('https://www.opensubtitles.com/en/consumers')
    expect(externalLinkUrl(ExternalLinkRequest.parse({ service: 'subdl' }))).toBe('https://subdl.com/panel/api')
  })

  it('sends a referrer with the embed (without one YouTube answers "Error 153"), from a name that is nobody\'s', () => {
    expect(new URL(TRAILER_REFERRER).protocol).toBe('https:')
    expect(new URL(TRAILER_REFERRER).hostname.endsWith('.invalid')).toBe(true)
  })

  it('keeps the trailer view on YouTube: https and YouTube hosts only', () => {
    expect(isTrailerPageAllowed('https://www.youtube-nocookie.com/embed/zSWdZVtXT7E')).toBe(true)
    expect(isTrailerPageAllowed('https://www.youtube.com/watch?v=zSWdZVtXT7E')).toBe(true)
    expect(isTrailerPageAllowed('http://www.youtube.com/watch?v=zSWdZVtXT7E')).toBe(false)
    expect(isTrailerPageAllowed('https://youtube.com.evil.example/')).toBe(false)
    expect(isTrailerPageAllowed('https://evil-youtube.com/')).toBe(false)
    expect(isTrailerPageAllowed('app://theama/index.html')).toBe(false)
    expect(isTrailerPageAllowed('not a url')).toBe(false)
  })

  it('rejects arbitrary URLs and malformed ids before building', () => {
    expect(() => ExternalLinkRequest.parse({ service: 'tmdb', kind: 'movie', id: 'https://evil.example' })).toThrow()
    expect(() => ExternalLinkRequest.parse({ service: 'imdb', id: '0816692' })).toThrow()
    expect(() => ExternalLinkRequest.parse({ service: 'youtube', id: 'too-short' })).toThrow()
  })
})
