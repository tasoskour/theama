import { describe, expect, it } from 'vitest'
import { SCENE_IDS } from '@theama/contracts'
import { kindFromRoute, normalizeGenre, resolveScene, sceneForGenre, sceneForGenres, type ScenePrefs } from './resolve'

const auto: ScenePrefs = { backdropScene: 'auto', backdropByGenre: true, backdropByKind: true }

describe('normalizeGenre', () => {
  it('ignores case, accents, punctuation and the Greek final sigma', () => {
    expect(normalizeGenre('Sci-Fi & Fantasy')).toBe('sci fi fantasy')
    expect(normalizeGenre('  Επιστημονική Φαντασία ')).toBe('επιστημονικη φαντασια')
    expect(normalizeGenre('Τρόμος')).toBe('τρομοσ')
  })
})

describe('sceneForGenre', () => {
  it('knows the English film and TV genres', () => {
    const table: Record<string, string> = {
      Action: 'action',
      'Action & Adventure': 'action',
      Adventure: 'western',
      Animation: 'animation',
      Comedy: 'comedy',
      Crime: 'crime',
      Documentary: 'documentary',
      Drama: 'drama',
      Family: 'family',
      Kids: 'family',
      Fantasy: 'fantasy',
      History: 'history',
      Horror: 'horror',
      Music: 'animation',
      Mystery: 'crime',
      Romance: 'romance',
      'Science Fiction': 'scifi',
      'Sci-Fi & Fantasy': 'scifi',
      Thriller: 'crime',
      War: 'history',
      'War & Politics': 'history',
      Western: 'western',
    }
    for (const [name, scene] of Object.entries(table)) expect(sceneForGenre(name), name).toBe(scene)
  })

  it('knows the Greek names TMDB returns', () => {
    const table: Record<string, string> = {
      Δράση: 'action',
      Περιπέτεια: 'western',
      'Κινούμενα σχέδια': 'animation',
      Κωμωδία: 'comedy',
      Έγκλημα: 'crime',
      Ντοκιμαντέρ: 'documentary',
      Δράμα: 'drama',
      Οικογενειακή: 'family',
      Φαντασία: 'fantasy',
      Ιστορία: 'history',
      Τρόμου: 'horror',
      Μουσική: 'animation',
      Μυστήριο: 'crime',
      Ρομαντική: 'romance',
      'Επιστημονική φαντασία': 'scifi',
      Θρίλερ: 'crime',
      Πολεμική: 'history',
      Γουέστερν: 'western',
      Παιδικά: 'family',
    }
    for (const [name, scene] of Object.entries(table)) expect(sceneForGenre(name), name).toBe(scene)
  })

  it('recognises other forms of a Greek word by its stem', () => {
    expect(sceneForGenre('Επιστημονικής Φαντασίας')).toBe('scifi')
    expect(sceneForGenre('Τρόμος')).toBe('horror')
    expect(sceneForGenre('Κωμωδίες')).toBe('comedy')
  })

  it('has no scene for genres that are not a mood', () => {
    for (const name of ['News', 'Reality', 'Soap', 'Talk', 'TV Movie', 'Ειδήσεις', 'Ριάλιτι', '']) expect(sceneForGenre(name), name).toBeNull()
  })

  it('only ever answers with a real scene', () => {
    for (const name of ['Action', 'Western', 'Δράμα', 'Sci-Fi & Fantasy']) expect(SCENE_IDS).toContain(sceneForGenre(name))
  })
})

describe('sceneForGenres', () => {
  it('lets the first recognised genre win when listed', () => {
    expect(sceneForGenres(['News', 'Comedy', 'Horror'], 'listed')).toBe('comedy')
  })
  it('lets the most characteristic genre win by priority', () => {
    expect(sceneForGenres(['Adventure', 'Drama', 'Science Fiction'], 'priority')).toBe('scifi') // Interstellar
    expect(sceneForGenres(['Action', 'Adventure'], 'priority')).toBe('action') // Mad Max: Fury Road
    expect(sceneForGenres(['Comedy', 'Thriller', 'Drama'], 'priority')).toBe('crime') // Parasite
  })
  it('answers null when nothing is recognised', () => {
    expect(sceneForGenres([], 'priority')).toBeNull()
    expect(sceneForGenres(['News'], 'listed')).toBeNull()
  })
})

describe('resolveScene', () => {
  it('keeps classic as the default, whatever is on screen', () => {
    const prefs: ScenePrefs = { backdropScene: 'classic', backdropByGenre: true, backdropByKind: true }
    expect(resolveScene({}, prefs)).toBe('classic')
    expect(resolveScene({ kind: 'series', genres: ['Horror'] }, prefs)).toBe('classic')
  })

  it('uses a scene chosen by hand everywhere', () => {
    const prefs: ScenePrefs = { backdropScene: 'horror', backdropByGenre: true, backdropByKind: true }
    expect(resolveScene({ kind: 'movie', genres: ['Comedy'] }, prefs)).toBe('horror')
    expect(resolveScene({}, prefs)).toBe('horror')
  })

  it('under Automatic: genre first, then kind, then classic', () => {
    expect(resolveScene({ kind: 'movie', genres: ['Horror'] }, auto)).toBe('horror')
    expect(resolveScene({ kind: 'movie', genres: ['News'] }, auto)).toBe('movie')
    expect(resolveScene({ kind: 'series' }, auto)).toBe('series')
    expect(resolveScene({ kind: 'video' }, auto)).toBe('video')
    expect(resolveScene({}, auto)).toBe('classic')
  })

  it('honours the two follow switches', () => {
    expect(resolveScene({ kind: 'movie', genres: ['Horror'] }, { ...auto, backdropByGenre: false })).toBe('movie')
    expect(resolveScene({ kind: 'movie', genres: ['Horror'] }, { ...auto, backdropByKind: false })).toBe('horror')
    expect(resolveScene({ kind: 'movie', genres: ['News'] }, { ...auto, backdropByKind: false })).toBe('classic')
    expect(resolveScene({ kind: 'movie', genres: ['Horror'] }, { ...auto, backdropByGenre: false, backdropByKind: false })).toBe('classic')
  })

  it('uses the priority order for a title and the listed order for a filter', () => {
    const genres = ['Comedy', 'Horror']
    expect(resolveScene({ genres, genreOrder: 'listed' }, auto)).toBe('comedy')
    expect(resolveScene({ genres, genreOrder: 'priority' }, auto)).toBe('horror')
  })
})

describe('kindFromRoute', () => {
  it('maps the browsing routes to a kind', () => {
    expect(kindFromRoute('movies')).toBe('movie')
    expect(kindFromRoute('collection')).toBe('movie')
    expect(kindFromRoute('series')).toBe('series')
    expect(kindFromRoute('videos')).toBe('video')
    expect(kindFromRoute('home')).toBeNull()
    expect(kindFromRoute(undefined)).toBeNull()
  })
})
