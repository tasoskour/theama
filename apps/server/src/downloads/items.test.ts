import { describe, expect, it } from 'vitest'
import { problemFor } from './items'

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
