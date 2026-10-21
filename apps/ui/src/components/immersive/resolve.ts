import type { BackdropScene, SceneId, TitleKind } from '@theama/contracts'

/**
 * Which backdrop scene to show. Pure and free of three.js, so it is cheap to test and to import anywhere.
 *
 * The default scene (`classic`) never changes with context. Only when the person picks Automatic does the scene
 * follow what is on screen: the genre of the title or of the genre filter first, then movie / series / video.
 */

export interface SceneContext {
  /** The kind of title on screen, when the page is about one kind. */
  kind?: TitleKind | null
  /** Genre names as the library stores them (TMDB names in the metadata language). */
  genres?: readonly string[]
  /**
   * `listed`: the first recognised genre wins (genres the person picked in the filter, in that order).
   * `priority`: the most characteristic genre wins (a title's genres; "Adventure, Drama, Science Fiction" is a sci-fi film).
   */
  genreOrder?: 'listed' | 'priority'
}

export interface ScenePrefs {
  backdropScene: BackdropScene
  backdropByGenre: boolean
  backdropByKind: boolean
}

/** Lowercase, no accents, no punctuation, one space between words; Greek final sigma folded so stems compare. */
export function normalizeGenre(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Exact names (normalised) for the TMDB genres, English and Greek, film and TV. */
const EXACT: Record<string, SceneId> = {
  // English
  action: 'action',
  'action adventure': 'action',
  adventure: 'western',
  animation: 'animation',
  comedy: 'comedy',
  crime: 'crime',
  thriller: 'crime',
  mystery: 'crime',
  documentary: 'documentary',
  drama: 'drama',
  family: 'family',
  kids: 'family',
  fantasy: 'fantasy',
  'sci fi fantasy': 'scifi',
  'science fiction': 'scifi',
  'sci fi': 'scifi',
  horror: 'horror',
  romance: 'romance',
  history: 'history',
  war: 'history',
  'war politics': 'history',
  western: 'western',
  music: 'animation',
  // Greek (normalised: no accents, final sigma folded)
  δραση: 'action',
  περιπετεια: 'western',
  'κινουμενα σχεδια': 'animation',
  κωμωδια: 'comedy',
  εγκλημα: 'crime',
  θριλερ: 'crime',
  μυστηριο: 'crime',
  ντοκιμαντερ: 'documentary',
  δραμα: 'drama',
  οικογενειακη: 'family',
  παιδικα: 'family',
  φαντασια: 'fantasy',
  'επιστημονικη φαντασια': 'scifi',
  τρομου: 'horror',
  τρομοσ: 'horror',
  ρομαντικη: 'romance',
  ιστορια: 'history',
  ιστορικη: 'history',
  πολεμικη: 'history',
  γουεστερν: 'western',
  μουσικη: 'animation',
}

/** Stems for names the exact table misses (a different gender or case of the same Greek word, a renamed TV genre). */
const STEMS: readonly [prefix: string, scene: SceneId][] = [
  ['επιστημονικ', 'scifi'],
  ['sci fi', 'scifi'],
  ['κινουμεν', 'animation'],
  ['τρομ', 'horror'],
  ['horror', 'horror'],
  ['κωμωδ', 'comedy'],
  ['εγκλημ', 'crime'],
  ['αστυνομικ', 'crime'],
  ['μυστηρ', 'crime'],
  ['θριλερ', 'crime'],
  ['ντοκιμαν', 'documentary'],
  ['δραμα', 'drama'],
  ['οικογεν', 'family'],
  ['φαντασ', 'fantasy'],
  ['ρομαντ', 'romance'],
  ['πολεμ', 'history'],
  ['ιστορ', 'history'],
  ['γουεστ', 'western'],
  ['δραση', 'action'],
  ['περιπετ', 'western'],
]

/** The scene a single genre name belongs to, or null when it has none (News, Reality, Talk, TV Movie ...). */
export function sceneForGenre(name: string): SceneId | null {
  const n = normalizeGenre(name)
  if (!n) return null
  const exact = EXACT[n]
  if (exact) return exact
  for (const [prefix, scene] of STEMS) if (n.startsWith(prefix)) return scene
  return null
}

/** Most characteristic first: a specific mood beats a broad one, and Adventure (the weakest signal) comes last. */
const PRIORITY: readonly SceneId[] = ['horror', 'scifi', 'fantasy', 'crime', 'history', 'animation', 'romance', 'action', 'comedy', 'documentary', 'family', 'drama', 'western']

/** The scene for a list of genre names, or null when none of them has one. */
export function sceneForGenres(genres: readonly string[], order: 'listed' | 'priority' = 'listed'): SceneId | null {
  const found = genres.map(sceneForGenre).filter((s): s is SceneId => s !== null)
  if (found.length === 0) return null
  if (order === 'listed') return found[0]!
  return [...found].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b))[0]!
}

const KIND_SCENE: Record<TitleKind, SceneId> = { movie: 'movie', series: 'series', video: 'video' }

/** The kind a page is about, from its route name, for pages that do not publish a hint of their own. */
export function kindFromRoute(routeName: string | symbol | null | undefined): TitleKind | null {
  switch (routeName) {
    case 'movies':
    case 'collections':
    case 'collection':
      return 'movie'
    case 'series':
      return 'series'
    case 'videos':
      return 'video'
    default:
      return null
  }
}

export function resolveScene(ctx: SceneContext, prefs: ScenePrefs): SceneId {
  // A scene chosen by hand (the default, classic, included) is used everywhere and ignores context.
  if (prefs.backdropScene !== 'auto') return prefs.backdropScene
  if (prefs.backdropByGenre && ctx.genres && ctx.genres.length > 0) {
    const byGenre = sceneForGenres(ctx.genres, ctx.genreOrder ?? 'listed')
    if (byGenre) return byGenre
  }
  if (prefs.backdropByKind && ctx.kind) return KIND_SCENE[ctx.kind]
  return 'classic'
}
