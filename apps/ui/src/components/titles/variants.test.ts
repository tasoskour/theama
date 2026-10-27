import { describe, expect, it } from 'vitest'
import type { MediaFile } from '@theama/contracts'
import { episodeChoiceKey, groupEpisodeFiles, loadChoices, pickDefaultFile, resolveChoice, saveChoice } from './variants'

const file = (over: Partial<MediaFile>): MediaFile =>
  ({ id: 1, path: 'C:\\a.mkv', state: 'available', positionSeconds: null, height: null, season: 1, episode: 1, ...over }) as MediaFile

function memory(initial?: string) {
  let value = initial ?? null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    read: () => value,
  }
}

describe('pickDefaultFile', () => {
  it('prefers a file that is present over a sharper one that is not', () => {
    const files = [file({ id: 1, height: 2160, state: 'source_offline' }), file({ id: 2, height: 720 })]
    expect(pickDefaultFile(files)?.id).toBe(2)
  })

  it('prefers the copy being watched, then the sharpest', () => {
    expect(pickDefaultFile([file({ id: 1, height: 2160 }), file({ id: 2, height: 720, positionSeconds: 90 })])?.id).toBe(2)
    expect(pickDefaultFile([file({ id: 1, height: 720 }), file({ id: 2, height: 1080 })])?.id).toBe(2)
  })

  it('keeps the first file when nothing tells them apart, and returns null for none', () => {
    expect(pickDefaultFile([file({ id: 5 }), file({ id: 6 })])?.id).toBe(5)
    expect(pickDefaultFile([])).toBeNull()
  })
})

describe('resolveChoice', () => {
  it('uses the chosen file, and falls back to the default when it is gone', () => {
    const files = [file({ id: 1, height: 720 }), file({ id: 2, height: 1080 })]
    expect(resolveChoice(files, 1)?.id).toBe(1)
    expect(resolveChoice(files, 99)?.id).toBe(2)
    expect(resolveChoice(files, undefined)?.id).toBe(2)
  })
})

describe('groupEpisodeFiles', () => {
  it('puts the files of one episode together and keeps the order of first appearance', () => {
    const groups = groupEpisodeFiles([
      file({ id: 1, season: 1, episode: 2 }),
      file({ id: 2, season: 1, episode: 1 }),
      file({ id: 3, season: 1, episode: 2 }),
      file({ id: 4, season: 2, episode: 1 }),
    ])
    expect(groups.map((g) => g.map((f) => f.id))).toEqual([[1, 3], [2], [4]])
  })

  it('never merges files without an episode number', () => {
    const groups = groupEpisodeFiles([file({ id: 1, episode: null }), file({ id: 2, episode: null })])
    expect(groups).toHaveLength(2)
  })
})

describe('remembered choices', () => {
  it('round-trips a choice and replaces an earlier one for the same key', () => {
    const store = memory()
    const key = episodeChoiceKey('series:show', 1, 2)
    saveChoice(key, 7, store)
    saveChoice('movie:x:2020', 3, store)
    saveChoice(key, 9, store)
    expect(loadChoices(store)).toEqual({ [key]: 9, 'movie:x:2020': 3 })
  })

  it('tolerates a missing, unreadable or broken store', () => {
    expect(loadChoices(null)).toEqual({})
    expect(loadChoices(memory('not json'))).toEqual({})
    expect(loadChoices(memory('[1,2]'))).toEqual({})
    expect(loadChoices(memory('{"a":1,"b":"x"}'))).toEqual({ a: 1 })
    expect(() => saveChoice('k', 1, { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })).not.toThrow()
    expect(() => saveChoice('k', 1, null)).not.toThrow()
  })

  it('keeps only the newest choices', () => {
    const store = memory()
    for (let i = 0; i < 520; i++) saveChoice(`k${i}`, i, store)
    const kept = loadChoices(store)
    expect(Object.keys(kept)).toHaveLength(500)
    expect(kept.k519).toBe(519)
    expect(kept.k0).toBeUndefined()
  })
})
