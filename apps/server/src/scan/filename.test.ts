import { describe, expect, it } from 'vitest'
import type { LibraryType } from '@theama/contracts'
import { isVideoFileName, parseMediaPath, type ParsedMedia } from './filename'

const p = (path: string, type: LibraryType = 'auto'): ParsedMedia => parseMediaPath(path.split('/'), type)

describe('movies (the brief\'s examples)', () => {
  it.each([
    ['Interstellar.2014.2160p.BluRay.x265.mkv', 'Interstellar', 2014],
    ['The.Dark.Knight.2008.REMUX.mkv', 'The Dark Knight', 2008],
    ['Dune.Part.Two.2024.1080p.WEB-DL.mkv', 'Dune Part Two', 2024],
    ['Blade.Runner.2049.2017.1080p.BluRay.mkv', 'Blade Runner 2049', 2017],
    ['Blade Runner 2049 (2017) 1080p.mkv', 'Blade Runner 2049', 2017],
    ['2001.A.Space.Odyssey.1968.1080p.mkv', '2001 A Space Odyssey', 1968],
    ['2012.1080p.BluRay.mkv', '2012', null],
    ['Ταινία (2020).mkv', 'Ταινία', 2020],
  ])('%s', (file, title, year) => {
    expect(p(file)).toMatchObject({ kind: 'movie', title, year, season: null, episode: null })
  })

  it('treats a release-style name with no year as a movie in Auto-detect', () => {
    expect(p('Some.Film.1080p.BluRay.x264-GRP.mkv')).toMatchObject({ kind: 'movie', title: 'Some Film', year: null })
  })
})

describe('episode numbering formats', () => {
  it.each([
    ['The.Last.of.Us.S01E03.HEVC.mkv', 'The Last of Us', 1, 3, null, null],
    ['Breaking Bad - 1x01.mp4', 'Breaking Bad', 1, 1, null, null],
    ['Breaking.Bad.S02E03-E04.mkv', 'Breaking Bad', 2, 3, 4, null],
    ['Show.S01E01E02.mkv', 'Show', 1, 1, 2, null],
    ['Show.S01E05-06.1080p.mkv', 'Show', 1, 5, 6, null],
    ['Show.S01E05.1080p.mkv', 'Show', 1, 5, null, null],
    ['Show.S01E05-1080p.mkv', 'Show', 1, 5, null, null],
    ['Breaking Bad/Season 01/01 - Pilot.mkv', 'Breaking Bad', 1, 1, null, 'Pilot'],
  ])('%s', (file, title, season, episode, episodeEnd, episodeTitle) => {
    expect(p(file)).toMatchObject({ kind: 'episode', title, season, episode, episodeEnd, episodeTitle })
  })
})

/** Real names from a user's downloaded-series folder: release groups, season packs, anime numbering, extras. */
describe('real-world series folder', () => {
  it('Arcane: season-pack folder, episode title between the numbering and the tags', () => {
    expect(
      p('Arcane.S02.COMPLETE.REPACK.1080p.NF.WEB-DL.DDP5.1.Atmos.H.264-FLUX[TGx]/Arcane.S02E03.Finally.Got.the.Name.Right.1080p.NF.WEB-DL.DDP5.1.Atmos.H.264-FLUX.mkv', 'series'),
    ).toEqual({ kind: 'episode', title: 'Arcane', year: null, season: 2, episode: 3, episodeEnd: null, episodeTitle: 'Finally Got the Name Right' })
  })

  it('Arcane: REPACK flag is not part of the episode title', () => {
    expect(p('Arcane.S02E07.Pretend.Like.Its.the.First.Time.REPACK.1080p.NF.WEB-DL.mkv', 'series').episodeTitle).toBe('Pretend Like Its the First Time')
  })

  it('MacGruber: nothing between the numbering and the tags means no episode title', () => {
    expect(p('MacGruber.S01E01.1080p.WEBRip.x265-RARBG[eztv.re].mp4', 'series')).toMatchObject({
      title: 'MacGruber', season: 1, episode: 1, episodeTitle: null,
    })
  })

  it('Re Zero: [group] prefix and a year that belongs to the show name', () => {
    expect(p('Re Zero 2020 (Season 1) (1080p)(HEVC x265 10bit)(Multi-Subs)-Judas[TGx]/[Judas] Re Zero 2020 - S01E13.mkv', 'series')).toMatchObject({
      kind: 'episode', title: 'Re Zero', year: 2020, season: 1, episode: 13,
    })
  })

  it('Mushishi: anime absolute numbering with a bracketed tag, no season', () => {
    expect(p('Mushishi 1080p [muxed with Niizk subs]/[BD] Mushishi 12 - One-Eyed Fish (1920x1080 x264 AAC 5.1ch).mkv', 'series')).toEqual({
      kind: 'episode', title: 'Mushishi', year: null, season: null, episode: 12, episodeEnd: null, episodeTitle: 'One-Eyed Fish',
    })
  })

  it('The Outsider: year in parentheses, dashes around the numbering, quality in parentheses', () => {
    expect(p('The Outsider (2020) Season 1 S01 (1080p BluRay x265 HEVC 10bit AAC 5.1 Silence)/The Outsider (2020) - S01E06 - The One About the Yiddish Vampire (1080p BluRay x265 Silence).mkv', 'series')).toEqual({
      kind: 'episode', title: 'The Outsider', year: 2020, season: 1, episode: 6, episodeEnd: null, episodeTitle: 'The One About the Yiddish Vampire',
    })
  })

  it('The Outsider: featurettes are extras, not episodes', () => {
    const r = p('The Outsider (2020) Season 1 S01 (1080p BluRay x265 HEVC 10bit AAC 5.1 Silence)/Featurettes/Stephen King and The Outsider.mkv', 'series')
    expect(r).toMatchObject({ kind: 'extra', title: 'Stephen King and The Outsider', season: null, episode: null })
  })

  it('Uncanny Counter: [KOREAN] tag and "Seasons 1 and 2" folder; Season folder supplies nothing wrong', () => {
    expect(p('The Uncanny Counter 2020 [KOREAN] Seasons 1 and 2 1080p NF WEB-DL x264 [i_c]/Season 1/The Uncanny Counter - S01E02 - Episode 2.mkv', 'series')).toMatchObject({
      title: 'The Uncanny Counter', season: 1, episode: 2, episodeTitle: 'Episode 2',
    })
  })

  it('X-Men \'97: site prefix, spaces instead of dots, and a "97" that is part of the title', () => {
    expect(
      p('www.UIndex.org    -    X-Men 97 S02E03 Rise of Apocalypse Part 1 2160p DSNP WEB-DL DDP5 1 Atmos DV HDR H 265-FLUX/X-Men 97 S02E03 Rise of Apocalypse Part 1 2160p DSNP WEB-DL DDP5 1 Atmos DV HDR H 265-FLUX.mkv', 'series'),
    ).toMatchObject({ title: 'X-Men 97', year: null, season: 2, episode: 3, episodeTitle: 'Rise of Apocalypse Part 1' })
  })

  it('Severance: lower-case folder from a different release is the same show title', () => {
    const a = p('Severance.S01.1080p.ATVP.WEB-DL.DDP5.1.Atmos.H.264-TEPES[rartv]/Severance.S01E02.Half.Loop.REPACK.1080p.ATVP.WEB-DL.mkv', 'series')
    const b = p('severance/Severance.S01E01.Good.News.About.Hell.1080p.HEVC.x265-MeGusta[TGx]/Severance.S01E01.Good.News.About.Hell.1080p.HEVC.x265-MeGusta.mkv', 'series')
    expect(a).toMatchObject({ title: 'Severance', season: 1, episode: 2, episodeTitle: 'Half Loop' })
    expect(b).toMatchObject({ title: 'Severance', season: 1, episode: 1, episodeTitle: 'Good News About Hell' })
  })

  it('a movie inside a Series folder follows the folder type (the user chose "Series"), unnumbered', () => {
    expect(p('The.Wrong.Guy.1997.720p.BluRay.x264-x0r[SN]/The.Wrong.Guy.1997.720p.BluRay.x264-x0r.mkv', 'series')).toMatchObject({
      kind: 'episode', title: 'The Wrong Guy', year: 1997, season: null, episode: null,
    })
  })

  it('...but the same file in an Auto-detect folder is recognised as a movie', () => {
    expect(p('The.Wrong.Guy.1997.720p.BluRay.x264-x0r[SN]/The.Wrong.Guy.1997.720p.BluRay.x264-x0r.mkv', 'auto')).toMatchObject({
      kind: 'movie', title: 'The Wrong Guy', year: 1997,
    })
  })
})

describe('folder context', () => {
  it('uses the show folder and Season folder when the file name has only a number', () => {
    expect(p('Friends/Season 03/05 - The One with the Jellyfish.mkv', 'series')).toMatchObject({
      title: 'Friends', season: 3, episode: 5, episodeTitle: 'The One with the Jellyfish',
    })
  })
  it('uses the source folder name when the source root is the show', () => {
    expect(p('Severance/S02E04.mkv', 'series')).toMatchObject({ title: 'Severance', season: 2, episode: 4 })
  })
  it('ignores generic root folder names such as "Series"', () => {
    expect(p('Series/Dark/Season 1/Dark.S01E01.mkv', 'series').title).toBe('Dark')
    expect(p('Series/S01E01.mkv', 'series').title).not.toBe('Series')
  })
  it('puts Specials in season 0', () => {
    expect(p('Doctor Who/Specials/Doctor.Who.2005.Christmas.Invasion.mkv', 'series')).toMatchObject({ season: null, kind: 'episode' })
    expect(p('Doctor Who/Specials/03 - Christmas.mkv', 'series')).toMatchObject({ season: 0, episode: 3 })
  })
})

describe('library type rules', () => {
  it('"My Videos" files are never interpreted: the name is kept as is', () => {
    expect(p('Holidays/IMG_2031.MOV', 'videos')).toEqual({
      kind: 'video', title: 'IMG_2031', year: null, season: null, episode: null, episodeEnd: null, episodeTitle: null,
    })
    expect(p('Family/Birthday.2019.S01E01.mp4', 'videos')).toMatchObject({ kind: 'video', title: 'Birthday.2019.S01E01', season: null })
  })
  it('Auto-detect never forces a plain personal video into a movie', () => {
    expect(p('Trip to Crete.mp4', 'auto')).toMatchObject({ kind: 'video', title: 'Trip to Crete' })
    expect(p('IMG_0042.mov', 'auto').kind).toBe('video')
  })
  it('a Movies folder is always movies, even with a release-style name', () => {
    expect(p('Movies/Film.S01E01.mkv', 'movies').kind).toBe('movie')
  })
})

describe('extras and junk', () => {
  it.each(['Movie.2020.1080p/Sample/sample.mkv', 'Movie/Trailers/Trailer.mkv', 'Show/sample.mkv', 'Show/Show.S01E01-sample.mkv', 'Movie/Behind The Scenes/Making.mkv'])(
    '%s is an extra',
    (path) => {
      expect(p(path, 'auto').kind).toBe('extra')
    },
  )
  it('does not mistake a title containing "sample" or "trailer" for an extra', () => {
    expect(p('Trailer.Park.Boys.S01E01.mkv', 'series').kind).toBe('episode')
    expect(p('The.Sample.Case.2010.mkv', 'auto').kind).toBe('movie')
  })
})

describe('isVideoFileName', () => {
  it('accepts video containers regardless of case and rejects everything else', () => {
    for (const ok of ['a.mkv', 'A.MP4', 'x.m4v', 'c.TS', 'd.webm', 'e.mpeg']) expect(isVideoFileName(ok)).toBe(true)
    for (const no of ['a.srt', 'b.txt', 'c.jpg', 'd.nfo', '.ce4dfb618e59.parts', 'mkv', '.mkv']) expect(isVideoFileName(no)).toBe(false)
  })
})
