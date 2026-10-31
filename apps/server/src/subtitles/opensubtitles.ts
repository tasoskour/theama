import { win32 } from 'node:path'
import { z } from 'zod'
import { SubtitleFormat } from '@theama/contracts'
import { ApiProblem, withTimeout } from '../library/sources'
import { APP_VERSION } from '../version'
import { movieHash } from './hash'
import { boundedBytes, subtitleFetch, subtitleJson } from './http'
import type { SubtitleCandidate, SubtitlePayload, SubtitleProvider, SubtitleQuery } from './provider'
import { toLanguageCode } from './languages'

export interface OpenSubtitlesCredentials { apiKey: string; username?: string; password?: string }
const RemoteId = z.union([z.string(), z.number()]).transform(String)
const SearchResponse = z.object({ data: z.array(z.object({ attributes: z.object({
  language: z.string(), release: z.string().nullish(), moviehash_match: z.boolean().optional(),
  foreign_parts_only: z.boolean().optional(), hearing_impaired: z.boolean().optional(),
  download_count: z.number().nullish(), ratings: z.union([z.string(), z.number()]).nullish(),
  files: z.array(z.object({ file_id: RemoteId, file_name: z.string() })),
}) })) })
const LoginResponse = z.object({ token: z.string().min(1), base_url: z.string().optional() })
const DownloadResponse = z.object({ link: z.string().url(), file_name: z.string() })

function decode<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ApiProblem('subtitle_provider_unavailable', 'OpenSubtitles returned an invalid response', 502)
  return parsed.data
}

export class OpenSubtitlesProvider implements SubtitleProvider {
  private token: string | null = null
  private sessionBase: string
  private loggingIn: Promise<void> | null = null
  private generation = 0
  constructor(private readonly credentials: () => OpenSubtitlesCredentials | null, private readonly apiBase = 'https://api.opensubtitles.com/api/v1') {
    this.sessionBase = apiBase
  }
  reset(): void { this.token = null; this.sessionBase = this.apiBase; this.generation++ }
  adoptSession(other: OpenSubtitlesProvider): void { this.token = other.token; this.sessionBase = other.sessionBase }
  secrets(): string[] { return this.token ? [this.token] : [] }
  private headers(): Record<string, string> {
    const credentials = this.credentials()
    if (!credentials) throw new ApiProblem('subtitle_not_configured', 'Configure OpenSubtitles in Playback settings first', 409)
    return { 'Api-Key': credentials.apiKey, 'User-Agent': `Theama v${APP_VERSION}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }
  }
  async login(): Promise<void> {
    if (this.loggingIn) return this.loggingIn
    const generation = this.generation
    this.loggingIn = (async () => {
      const c = this.credentials()
      if (!c?.username || !c.password) throw new ApiProblem('subtitle_auth', 'Enter an OpenSubtitles username and password', 400)
      const result = decode(LoginResponse, await subtitleJson(new URL(`${this.apiBase}/login`), {
        method: 'POST', headers: this.headers(), body: JSON.stringify({ username: c.username, password: c.password }),
      }))
      if (generation !== this.generation) throw new ApiProblem('subtitle_auth', 'Subtitle credentials changed. Try again.', 409)
      if (result.base_url && new URL(this.apiBase).protocol === 'https:') {
        const host = result.base_url.replace(/^https:\/\//, '').replace(/\/$/, '')
        if (!['api.opensubtitles.com', 'vip-api.opensubtitles.com'].includes(host)) throw new ApiProblem('subtitle_provider_unavailable', 'OpenSubtitles returned an unsupported API address', 502)
        this.sessionBase = `https://${host}/api/v1`
      }
      this.token = result.token
    })().finally(() => { this.loggingIn = null })
    return this.loggingIn
  }
  private async request(path: string, body?: unknown, retry = true): Promise<unknown> {
    if (this.credentials()?.username && !this.token) await this.login()
    try {
      return await subtitleJson(new URL(`${this.sessionBase}${path}`), {
        headers: this.headers(), ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      })
    } catch (err) {
      if (retry && err instanceof ApiProblem && err.apiCode === 'subtitle_auth' && this.credentials()?.username) {
        this.token = null
        await this.login()
        return this.request(path, body, false)
      }
      throw err
    }
  }
  async test(): Promise<void> {
    if (this.credentials()?.username) await this.login()
    else await this.request('/subtitles?imdb_id=0133093&languages=en')
  }
  async search(q: SubtitleQuery): Promise<SubtitleCandidate[]> {
    const hash = await withTimeout(movieHash(q.path)).catch(() => null)
    // OpenSubtitles asks for alphabetical order so equivalent searches share a cache entry.
    const params: Record<string, string> = { languages: [...q.languages].sort().join(','), type: q.kind === 'movie' ? 'movie' : 'episode' }
    if (q.imdbId) params.imdb_id = q.imdbId.replace(/^tt/, '')
    else if (q.tmdbId) params[q.kind === 'episode' ? 'parent_tmdb_id' : 'tmdb_id'] = q.tmdbId
    else params.query = q.title.toLowerCase()
    if (hash) params.moviehash = hash
    if (q.year !== null && q.kind === 'movie') params.year = String(q.year)
    if (q.season !== null) params.season_number = String(q.season)
    if (q.episode !== null) params.episode_number = String(q.episode)
    const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))
    const response = decode(SearchResponse, await this.request(`/subtitles?${query}`))
    return response.data.flatMap(({ attributes: a }) => a.files.map((file) => ({
      remoteId: file.file_id, release: a.release || file.file_name, language: toLanguageCode(a.language) ?? a.language,
      format: SubtitleFormat.safeParse(win32.extname(file.file_name).slice(1).toLowerCase()).data ?? null,
      hashMatch: a.moviehash_match ?? false, forced: a.foreign_parts_only ?? false, sdh: a.hearing_impaired ?? false,
      downloads: a.download_count ?? null, rating: a.ratings != null && Number.isFinite(Number(a.ratings)) ? Number(a.ratings) : null,
    }))).filter((r) => q.languages.includes(r.language))
  }
  async download(candidate: SubtitleCandidate): Promise<SubtitlePayload> {
    const response = decode(DownloadResponse, await this.request('/download', { file_id: Number(candidate.remoteId) }))
    const link = new URL(response.link)
    const origins = ['https://dl.opensubtitles.com', 'https://www.opensubtitles.com', new URL(this.apiBase).origin]
    return { bytes: await boundedBytes(await subtitleFetch(link, {}, origins)), fileName: response.file_name }
  }
}
