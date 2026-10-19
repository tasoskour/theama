import { describe, expect, it } from 'vitest'
import { chooseSubtitle, discoverExternal, type ExternalSubtitle } from './discover'
import { normaliseLanguage, toLanguageCode } from './languages'

/** A fake directory tree: folder path -> file names. A folder not listed cannot be read. */
const tree =
  (dirs: Record<string, string[]>) =>
  async (dir: string): Promise<string[]> => {
    const found = dirs[dir]
    if (!found) throw new Error('ENOENT')
    return found
  }

describe('languages', () => {
  it('maps codes, 3-letter codes, names and common abuse to ISO 639-1', () => {
    expect(['en', 'eng', 'English', 'el', 'ell', 'gre', 'Greek', 'GR', 'fre', 'ger'].map(toLanguageCode)).toEqual(['en', 'en', 'en', 'el', 'el', 'el', 'el', 'el', 'fr', 'de'])
    expect(toLanguageCode('klingon')).toBeNull()
  })
  it('keeps unknown tags from the file as written, and drops "undetermined"', () => {
    expect(normaliseLanguage('GRE')).toBe('el')
    expect(normaliseLanguage('tlh')).toBe('tlh')
    expect(normaliseLanguage('und')).toBeNull()
    expect(normaliseLanguage('')).toBeNull()
  })
})

describe('discoverExternal', () => {
  const video = 'D:\\Media\\Film (2020)\\Film (2020).mkv'

  it('finds subtitles that start with the video name, with language and flags from the tags', async () => {
    const found = await discoverExternal(
      video,
      tree({
        'D:\\Media\\Film (2020)': [
          'Film (2020).mkv',
          'Film (2020).srt',
          'Film (2020).el.srt',
          'Film (2020).en.forced.srt',
          'Film (2020).English.SDH.ass',
          'Film (2020) - gr.srt',
          'Other Film.en.srt',
          'Film (2020).nfo',
          'Film (2020)2.srt',
        ],
      }),
    )
    expect(found.map((s) => [s.fileName, s.language, s.forced, s.sdh])).toEqual([
      ['Film (2020) - gr.srt', 'el', false, false],
      ['Film (2020).el.srt', 'el', false, false],
      ['Film (2020).en.forced.srt', 'en', true, false],
      ['Film (2020).English.SDH.ass', 'en', false, true],
      ['Film (2020).srt', null, false, false],
    ])
    expect(found[0]?.path).toBe('D:\\Media\\Film (2020)\\Film (2020) - gr.srt')
  })

  it('looks in Subs and Subtitles folders, and in a folder named after the video whatever the files are called', async () => {
    const found = await discoverExternal(
      video,
      tree({
        'D:\\Media\\Film (2020)': ['Film (2020).mkv'],
        'D:\\Media\\Film (2020)\\Subs': ['Film (2020).fr.srt', 'random.srt'],
        'D:\\Media\\Film (2020)\\Subs\\Film (2020)': ['2_English.srt', '3_Greek.srt', 'cover.jpg'],
      }),
    )
    expect(found.map((s) => [s.fileName, s.language])).toEqual([
      ['2_English.srt', 'en'],
      ['3_Greek.srt', 'el'],
      ['Film (2020).fr.srt', 'fr'],
    ])
  })

  it('is case-insensitive, and finds nothing (rather than failing) when the folder cannot be read', async () => {
    expect((await discoverExternal('D:\\M\\FILM.mkv', tree({ 'D:\\M': ['film.EN.SRT'] })))[0]).toMatchObject({ language: 'en', format: 'srt' })
    expect(await discoverExternal('D:\\Gone\\Film.mkv', tree({}))).toEqual([])
  })
})

describe('chooseSubtitle', () => {
  const sub = (language: string | null, extra: Partial<ExternalSubtitle> = {}): ExternalSubtitle => ({
    path: `D:\\${language ?? 'none'}${extra.sdh ? '-sdh' : ''}${extra.forced ? '-forced' : ''}.srt`, fileName: 'x.srt', format: 'srt', language, forced: false, sdh: false, ...extra,
  })

  it('takes the first preferred language that exists, in order of preference', () => {
    const list = [sub('en'), sub('el'), sub('fr')]
    expect(chooseSubtitle(list, ['el', 'en'])?.language).toBe('el')
    expect(chooseSubtitle(list, ['de', 'en'])?.language).toBe('en')
  })
  it('prefers a normal subtitle over a hearing-impaired one, and never picks a forced-only one', () => {
    expect(chooseSubtitle([sub('en', { sdh: true }), sub('en')], ['en'])?.sdh).toBe(false)
    expect(chooseSubtitle([sub('en', { sdh: true })], ['en'])?.sdh).toBe(true)
    expect(chooseSubtitle([sub('en', { forced: true })], ['en'])).toBeNull()
  })
  it('returns null when nothing matches, so the player does what it normally does', () => {
    expect(chooseSubtitle([sub(null), sub('fr')], ['el', 'en'])).toBeNull()
    expect(chooseSubtitle([], ['en'])).toBeNull()
  })
})
