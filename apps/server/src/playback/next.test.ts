import { describe, expect, it } from 'vitest'
import { nextEpisode, type EpisodeFile } from './next'

let id = 0
const ep = (season: number | null, episode: number | null, watched = false, available = true): EpisodeFile => ({ id: ++id, season, episode, watched, available })

describe('nextEpisode', () => {
  it('starts at the first episode when nothing has been watched', () => {
    const files = [ep(1, 2), ep(1, 1), ep(1, 3)]
    expect(nextEpisode(files)).toMatchObject({ season: 1, episode: 1, label: 'S01E01' })
  })

  it('goes to the first unwatched episode after the last one watched', () => {
    expect(nextEpisode([ep(1, 1, true), ep(1, 2, true), ep(1, 3), ep(1, 4)])).toMatchObject({ label: 'S01E03' })
  })

  it('crosses into the next season', () => {
    expect(nextEpisode([ep(1, 1, true), ep(1, 2, true), ep(2, 1), ep(2, 2)])).toMatchObject({ season: 2, episode: 1 })
  })

  it('skips episodes the library does not have', () => {
    // E02 and E03 are not on disk: after E01 the next thing to play is E04.
    expect(nextEpisode([ep(1, 1, true), ep(1, 4), ep(1, 5)])).toMatchObject({ label: 'S01E04' })
  })

  it('respects a deliberate skip: unwatched episodes before the last watched one are not offered', () => {
    expect(nextEpisode([ep(1, 1), ep(1, 2), ep(1, 3, true), ep(1, 4)])).toMatchObject({ label: 'S01E04' })
    expect(nextEpisode([ep(1, 1), ep(1, 2), ep(1, 3, true)])).toBeNull()
  })

  it('returns null once everything is watched', () => {
    expect(nextEpisode([ep(1, 1, true), ep(1, 2, true)])).toBeNull()
    expect(nextEpisode([])).toBeNull()
  })

  it('counts an episode as watched when any of its files is, and offers the copy that is available', () => {
    const watchedCopy = ep(1, 1, true, false)
    const otherCopy = ep(1, 1, false, true)
    expect(nextEpisode([watchedCopy, otherCopy, ep(1, 2)])).toMatchObject({ label: 'S01E02' })
    const offline = ep(1, 3, false, false)
    const online = ep(1, 3, false, true)
    expect(nextEpisode([offline, online])).toMatchObject({ fileId: online.id })
  })

  it('still offers an episode whose drive is offline when nothing else is left', () => {
    const offline = ep(1, 1, false, false)
    expect(nextEpisode([offline])).toMatchObject({ fileId: offline.id })
  })

  it('leaves out specials and files without numbers', () => {
    expect(nextEpisode([ep(0, 1), ep(null, null), ep(1, null)])).toBeNull()
    expect(nextEpisode([ep(0, 1), ep(1, 1)])).toMatchObject({ label: 'S01E01' })
  })
})
