import { describe, expect, it } from 'vitest'
import { cleanFileName, renderTemplate, TemplateError, validateTemplate, type TemplateValues } from './template'

const values = (over: Partial<TemplateValues> = {}): TemplateValues => ({
  title: 'Severance', year: 2022, season: 1, episode: 2, episodeCode: 'S01E02', episodeTitle: 'Half Loop', resolution: '1080p', videoCodec: 'HEVC', ...over,
})

describe('validateTemplate', () => {
  it('accepts the default templates and padded numbers', () => {
    expect(() => validateTemplate('{title} ({year})')).not.toThrow()
    expect(() => validateTemplate('{title} - {episodeCode} - {episodeTitle}')).not.toThrow()
    expect(() => validateTemplate('{title} S{season:00}E{episode:00}')).not.toThrow()
  })
  it('refuses unknown names, stray braces, folders and templates with nothing in them', () => {
    expect(() => validateTemplate('{titel} ({year})')).toThrow(/Unknown name \{titel\}/)
    expect(() => validateTemplate('{title ({year})')).toThrow(TemplateError)
    expect(() => validateTemplate('{title}/{year}')).toThrow(/folder/)
    expect(() => validateTemplate('..\\{title}')).toThrow(/folder/)
    expect(() => validateTemplate('Same name')).toThrow(/same name/)
  })
})

describe('renderTemplate', () => {
  it('fills in names and pads numbers', () => {
    expect(renderTemplate('{title} S{season:00}E{episode:00} [{resolution}]', values())).toBe('Severance S01E02 [1080p]')
    expect(renderTemplate('{season:000}', values())).toBe('001')
    expect(renderTemplate('{season}', values({ season: 12 }))).toBe('12')
  })
  it('leaves missing values empty', () => {
    expect(renderTemplate('{title} ({year})', values({ year: null }))).toBe('Severance ()')
  })
})

describe('cleanFileName', () => {
  it('drops the empty brackets and dangling separators that missing values leave behind', () => {
    expect(cleanFileName('Severance ()')).toBe('Severance')
    expect(cleanFileName('Severance - S01E02 - ')).toBe('Severance - S01E02')
    expect(cleanFileName('Severance -  - Half Loop')).toBe('Severance - Half Loop')
    expect(cleanFileName('Film [] (2020)')).toBe('Film (2020)')
    expect(cleanFileName('Film (2020 - )')).toBe('Film (2020)')
  })
  it('makes characters Windows forbids read naturally', () => {
    expect(cleanFileName('Mad Max: Fury Road (2015)')).toBe('Mad Max - Fury Road (2015)')
    expect(cleanFileName('AC/DC: Live | 1991')).toBe('AC-DC - Live - 1991')
    expect(cleanFileName('Who Framed "Roger" Rabbit? <1988>')).toBe("Who Framed 'Roger' Rabbit 1988")
    expect(cleanFileName('a\u0000b\u001fc')).toBe('abc')
  })
  it('removes trailing dots and spaces, which Windows would silently strip', () => {
    expect(cleanFileName('Film... ')).toBe('Film')
  })
  it('protects reserved device names and long names', () => {
    expect(cleanFileName('CON')).toBe('_CON')
    expect(cleanFileName('nul')).toBe('_nul')
    expect(cleanFileName('x'.repeat(400))).toHaveLength(180)
  })
  it('keeps Greek and other scripts as they are', () => {
    expect(cleanFileName('Η Ταινία (2020)')).toBe('Η Ταινία (2020)')
  })
})
