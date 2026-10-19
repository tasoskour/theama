import { z } from 'zod'
import type { MatchKind } from '@theama/contracts'
import { ResilientHttp } from './http'
import {
  ProviderError,
  type ImageSize,
  type ProviderCollection,
  type MetadataProvider,
  type ProviderCandidate,
  type ProviderEpisode,
  type ProviderTitle,
  type SearchQuery,
} from './provider'

export const TMDB_API_BASE = 'https://api.themoviedb.org/3'
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

const IMAGE_SIZES: Record<ImageSize, string> = { thumb: 'w185', poster: 'w500', backdrop: 'w1280', still: 'w300' }

/** TMDB sends `null`, `""` and absent for "nothing"; all become null. */
const text = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null))
const num = z
  .number()
  .nullish()
  .transform((v) => v ?? null)

const yearOf = (date: string | null): number | null => {
  const y = date ? Number(date.slice(0, 4)) : NaN
  return Number.isInteger(y) && y > 1800 ? y : null
}

const SearchResult = z.object({
  id: z.number().int(),
  title: text,
  name: text,
  original_title: text,
  original_name: text,
  release_date: text,
  first_air_date: text,
  overview: text,
  poster_path: text,
  popularity: z
    .number()
    .nullish()
    .transform((v) => v ?? 0),
})
const SearchResponse = z.object({ results: z.array(SearchResult) })

const Detail = z.object({
  id: z.number().int(),
  title: text,
  name: text,
  original_title: text,
  original_name: text,
  release_date: text,
  first_air_date: text,
  tagline: text,
  overview: text,
  runtime: num,
  episode_run_time: z
    .array(z.number())
    .nullish()
    .transform((v) => v ?? []),
  genres: z
    .array(z.object({ name: z.string() }))
    .nullish()
    .transform((v) => v ?? []),
  vote_average: num,
  vote_count: num,
  poster_path: text,
  backdrop_path: text,
  status: text,
  imdb_id: text,
  external_ids: z.object({ imdb_id: text }).nullish(),
  credits: z
    .object({ cast: z.array(z.object({ name: z.string(), character: text, order: z.number().nullish() })).nullish() })
    .nullish(),
  seasons: z
    .array(z.object({ season_number: z.number().int() }))
    .nullish()
    .transform((v) => v ?? []),
  belongs_to_collection: z
    .object({ id: z.number().int(), name: text })
    .nullish()
    .transform((v) => v ?? null),
})

const Collection = z.object({
  id: z.number().int(),
  name: text,
  overview: text,
  poster_path: text,
  backdrop_path: text,
  parts: z
    .array(z.object({ id: z.number().int(), title: text, release_date: text, overview: text, poster_path: text }))
    .nullish()
    .transform((v) => v ?? []),
})

const Season = z.object({
  episodes: z
    .array(
      z.object({
        episode_number: z.number().int(),
        name: text,
        overview: text,
        air_date: text,
        runtime: num,
        still_path: text,
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
})

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value)
  if (!r.success) throw new ProviderError('unavailable', 'The provider sent data in an unexpected shape')
  return r.data
}

export interface TmdbOptions {
  /** A v3 API key or a v4 read-access token (a long JWT); both work. */
  credential: () => string | null
  apiBase?: string
  imageBase?: string
  http?: ResilientHttp
}

/** The TMDB adapter. Only reads; never sends anything about the user's library beyond the search text. */
export class TmdbProvider implements MetadataProvider {
  readonly id = 'tmdb'
  readonly http: ResilientHttp
  private readonly apiBase: string
  private readonly imageBase: string
  private readonly credential: () => string | null

  constructor(options: TmdbOptions) {
    this.credential = options.credential
    this.apiBase = (options.apiBase ?? TMDB_API_BASE).replace(/\/$/, '')
    this.imageBase = (options.imageBase ?? TMDB_IMAGE_BASE).replace(/\/$/, '')
    this.http = options.http ?? new ResilientHttp()
  }

  private async call(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
    const key = this.credential()
    if (!key) throw new ProviderError('auth', 'No TMDB API key is configured')
    const url = new URL(`${this.apiBase}${path}`)
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    const headers: Record<string, string> = { Accept: 'application/json' }
    // v4 read-access tokens are JWTs; v3 keys are 32 hex characters and travel as a query parameter.
    if (key.split('.').length === 3) headers.Authorization = `Bearer ${key}`
    else url.searchParams.set('api_key', key)
    return this.http.getJson(url, headers)
  }

  reset(): void {
    this.http.reset()
  }

  close(): void {
    this.http.close()
  }

  async validate(): Promise<void> {
    await this.call('/configuration', {})
  }

  async search(q: SearchQuery): Promise<ProviderCandidate[]> {
    const tv = q.kind === 'series'
    const data = parse(
      SearchResponse,
      await this.call(tv ? '/search/tv' : '/search/movie', {
        query: q.title,
        language: q.language,
        include_adult: 'false',
        page: 1,
        ...(q.year ? (tv ? { first_air_date_year: q.year } : { year: q.year }) : {}),
      }),
    )
    return data.results.map((r) => {
      const title = (tv ? r.name : r.title) ?? r.title ?? r.name ?? ''
      return {
        externalId: String(r.id),
        kind: q.kind,
        title,
        originalTitle: (tv ? r.original_name : r.original_title) ?? null,
        year: yearOf(tv ? r.first_air_date : r.release_date),
        overview: r.overview,
        posterPath: r.poster_path,
        popularity: r.popularity,
      }
    })
  }

  private async detail(kind: MatchKind, id: string, language: string): Promise<ProviderTitle> {
    const tv = kind === 'series'
    const d = parse(
      Detail,
      await this.call(`/${tv ? 'tv' : 'movie'}/${encodeURIComponent(id)}`, {
        language,
        append_to_response: 'credits,external_ids',
      }),
    )
    const runtime = tv ? (d.episode_run_time[0] ?? null) : d.runtime
    return {
      externalId: String(d.id),
      kind,
      title: (tv ? d.name : d.title) ?? d.title ?? d.name ?? '',
      originalTitle: (tv ? d.original_name : d.original_title) ?? null,
      year: yearOf(tv ? d.first_air_date : d.release_date),
      tagline: d.tagline,
      overview: d.overview,
      runtimeMinutes: runtime && runtime > 0 ? Math.round(runtime) : null,
      genres: d.genres.map((g) => g.name),
      rating: d.vote_average !== null && d.vote_count ? { value: d.vote_average, votes: d.vote_count } : null,
      posterPath: d.poster_path,
      backdropPath: d.backdrop_path,
      cast: (d.credits?.cast ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
        .slice(0, 15)
        .map((c) => ({ name: c.name, character: c.character })),
      imdbId: d.imdb_id ?? d.external_ids?.imdb_id ?? null,
      status: d.status,
      seasons: d.seasons.map((s) => s.season_number),
      collection: !tv && d.belongs_to_collection ? { externalId: String(d.belongs_to_collection.id), name: d.belongs_to_collection.name ?? '' } : null,
    }
  }

  /**
   * Details in the requested language, with each field the provider has no translation for filled from
   * English. Proper names are whatever the provider holds; nothing is machine-translated.
   */
  async fetchTitle(kind: MatchKind, externalId: string, language: string): Promise<ProviderTitle> {
    const primary = await this.detail(kind, externalId, language)
    if (language.toLowerCase().startsWith('en')) return primary
    if (primary.overview && primary.tagline !== null && primary.genres.length > 0) return primary
    const english = await this.detail(kind, externalId, 'en-US').catch((err: unknown) => {
      if (err instanceof ProviderError && err.kind === 'unavailable') return null
      throw err
    })
    if (!english) return primary
    return {
      ...primary,
      overview: primary.overview ?? english.overview,
      tagline: primary.tagline ?? english.tagline,
      genres: primary.genres.length ? primary.genres : english.genres,
      posterPath: primary.posterPath ?? english.posterPath,
      backdropPath: primary.backdropPath ?? english.backdropPath,
    }
  }

  async fetchCollection(externalId: string, language: string): Promise<ProviderCollection> {
    const get = async (lang: string) => parse(Collection, await this.call(`/collection/${encodeURIComponent(externalId)}`, { language: lang }))
    const c = await get(language)
    // A collection translated only in part keeps English for the gaps, like titles do.
    const en = language.toLowerCase().startsWith('en') || (c.name && c.overview) ? null : await get('en-US').catch(() => null)
    const enParts = new Map((en?.parts ?? []).map((p) => [p.id, p]))
    return {
      externalId: String(c.id),
      name: c.name ?? en?.name ?? '',
      overview: c.overview ?? en?.overview ?? null,
      posterPath: c.poster_path ?? en?.poster_path ?? null,
      backdropPath: c.backdrop_path ?? en?.backdrop_path ?? null,
      parts: c.parts.map((p) => {
        const fallback = enParts.get(p.id)
        const releaseDate = p.release_date
        const year = releaseDate ? Number(releaseDate.slice(0, 4)) : NaN
        return {
          externalId: String(p.id),
          title: p.title ?? fallback?.title ?? '',
          year: Number.isInteger(year) && year > 1800 ? year : null,
          releaseDate,
          overview: p.overview ?? fallback?.overview ?? null,
          posterPath: p.poster_path ?? fallback?.poster_path ?? null,
        }
      }),
    }
  }

  async fetchSeason(seriesId: string, season: number, language: string): Promise<ProviderEpisode[]> {
    const fetchIn = async (lang: string): Promise<ProviderEpisode[]> => {
      const s = parse(Season, await this.call(`/tv/${encodeURIComponent(seriesId)}/season/${season}`, { language: lang }))
      return s.episodes.map((e) => ({
        season,
        episode: e.episode_number,
        name: e.name,
        overview: e.overview,
        airDate: e.air_date,
        runtimeMinutes: e.runtime && e.runtime > 0 ? Math.round(e.runtime) : null,
        stillPath: e.still_path,
      }))
    }
    const primary = await fetchIn(language)
    if (language.toLowerCase().startsWith('en') || primary.every((e) => e.overview && e.name)) return primary
    const english = await fetchIn('en-US').catch(() => [] as ProviderEpisode[])
    const byNumber = new Map(english.map((e) => [e.episode, e]))
    return primary.map((e) => {
      const en = byNumber.get(e.episode)
      return en ? { ...e, name: e.name ?? en.name, overview: e.overview ?? en.overview, stillPath: e.stillPath ?? en.stillPath } : e
    })
  }

  imageUrl(path: string, size: ImageSize): string {
    return `${this.imageBase}/${IMAGE_SIZES[size]}${path.startsWith('/') ? '' : '/'}${path}`
  }
}
