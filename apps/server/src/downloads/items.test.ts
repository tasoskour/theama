import { describe, expect, it } from 'vitest'
import { problemFor, toItem } from './items'
import type { QBittorrentTorrent } from './qbittorrent'

describe('problemFor', () => {
  const log = [
    'File error alert. Torrent: "Other". File: "D:\o.mkv". Reason: "o.mkv file_open error: Access is denied"',
    'File error alert. Torrent: "Movie.2024". File: "D:\m.mkv". Reason: "m.mkv file_open (D:\m.mkv) error: Access is denied"',
  ]

  it('gives the reason from the newest line naming the torrent', () => {
    expect(problemFor('Movie.2024', log)).toBe('m.mkv file_open (D:\m.mkv) error: Access is denied')
  })

  it('returns null when the log does not mention it', () => {
    expect(problemFor('Nope', log)).toBeNull()
  })
})

describe('toItem', () => {
  const torrent = (tags: string): QBittorrentTorrent => ({ hash: 'a'.repeat(40), name: 'Movie.2024', state: 'downloading', progress: 0.5, dlspeed: 1, size: 10, eta: 5, tags, addedOn: 0 })

  it('reads the TMDB id Theama tagged a movie download with', () => {
    expect(toItem(torrent('theama, theama-movie, theama-tmdb-603'), 'theama')).toMatchObject({ kind: 'movie', tmdbId: '603' })
  })

  it('has no TMDB id for other torrents or a malformed tag', () => {
    expect(toItem(torrent('theama, theama-movie'), 'theama').tmdbId).toBeNull()
    expect(toItem(torrent('theama-tmdb-abc'), 'theama').tmdbId).toBeNull()
  })
})
