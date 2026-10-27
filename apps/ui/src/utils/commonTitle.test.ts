import { describe, expect, it } from 'vitest'
import { commonTitlePrefix } from './commonTitle'

describe('commonTitlePrefix', () => {
  it('keeps the shared show name and drops the episode number and what follows', () => {
    expect(commonTitlePrefix([
      'Chibi Maruko-chan 007 ちびまる子ちゃん 第7話 - mEQXU4ocJaI',
      'Chibi Maruko-chan 008 ちびまる子ちゃん 第8話 - zrrd2XAB8Eo',
      'Chibi Maruko-chan 016 ちびまる子ちゃん 第16話 - 8GvG3TLRQFo',
    ])).toBe('Chibi Maruko-chan')
  })

  it('ignores case and a trailing separator', () => {
    expect(commonTitlePrefix(['Mushishi - 01', 'mushishi - 02'])).toBe('Mushishi')
  })

  it('a number that belongs to the title stays when every title has it', () => {
    expect(commonTitlePrefix(['Apollo 13 Part One', 'Apollo 13 Part Two'])).toBe('Apollo 13 Part')
  })

  it('falls back to the first title when nothing is shared, and to the only title', () => {
    expect(commonTitlePrefix(['Alpha', 'Beta'])).toBe('Alpha')
    expect(commonTitlePrefix(['Just One'])).toBe('Just One')
    expect(commonTitlePrefix([])).toBe('')
  })
})
