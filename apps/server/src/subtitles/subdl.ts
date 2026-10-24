import { win32 } from 'node:path'
import { z } from 'zod'
import { SubtitleFormat } from '@theama/contracts'
import { ApiProblem } from '../library/sources'
import { boundedBytes, subtitleFetch, subtitleJson } from './http'
import { toLanguageCode } from './languages'
import type { SubtitleCandidate, SubtitlePayload, SubtitleProvider, SubtitleQuery } from './provider'

const SearchResponse = z.object({
  status: z.boolean(), error: z.string().optional(),
  subtitles: z.array(z.object({
    release_name: z.string().nullish(), name: z.string().optional(), language: z.string().optional(), lang: z.string().optional(),
    url: z.string(), hi: z.boolean().optional(), full_season: z.boolean().optional(),
    season: z.number().nullish(), episode: z.number().nullish(),
  })).default([]),
})

export class SubdlProvider implements SubtitleProvider {
  constructor(private readonly key: () => string | null, private readonly apiBase = 'https://api.subdl.com/api/v1', private readonly downloadBase = 'https://dl.subdl.com') {}
  private async request(params: Record<string, string>): Promise<z.infer<typeof SearchResponse>> {
    const key = this.key()
    if (!key) throw new ApiProblem('subtitle_not_configured', 'Configure SubDL in Playback settings first', 409)
    const url = new URL(`${this.apiBase}/subtitles`)
    url.search = new URLSearchParams({ ...params, api_key: key }).toString()
    const parsed = SearchResponse.safeParse(await subtitleJson(url))
    if (!parsed.success) throw new ApiProblem('subtitle_provider_unavailable', 'SubDL returned an invalid response', 502)
    if (!parsed.data.status) {
      const message = parsed.data.error ?? ''
      if (/limit|quota|too many/i.test(message)) throw new ApiProblem('subtitle_quota', 'The SubDL allowance is exhausted. Try again later.', 429)
      if (/key|auth|unauthorized/i.test(message)) throw new ApiProblem('subtitle_auth', 'SubDL did not accept the API key', 401)
      if (/not found|no subtitle|no result/i.test(message)) return { status: true, subtitles: [] }
      throw new ApiProblem('subtitle_provider_unavailable', 'SubDL could not complete the search. Try again.', 502)
    }
    return parsed.data
  }
  async test(): Promise<void> { await this.request({ imdb_id: 'tt0133093', languages: 'EN' }) }
  async search(q: SubtitleQuery): Promise<SubtitleCandidate[]> {
    const params: Record<string, string> = { languages: q.language.toUpperCase(), type: q.kind === 'movie' ? 'movie' : 'tv', full_season: '0', subs_per_page: '30', releases: '1', client: 'custom_integration' }
    if (q.imdbId) params.imdb_id = q.imdbId
    else if (q.tmdbId) params.tmdb_id = q.tmdbId
    else params.film_name = q.title
    if (q.year !== null && q.kind === 'movie') params.year = String(q.year)
    if (q.season !== null) params.season_number = String(q.season)
    if (q.episode !== null) params.episode_number = String(q.episode)
    const response = await this.request(params)
    return response.subtitles.filter((r) => !r.full_season && (toLanguageCode(r.language ?? r.lang) ?? (r.language ?? r.lang ?? q.language).toLowerCase()) === q.language
      && (q.season === null || r.season == null || q.season === r.season) && (q.episode === null || r.episode == null || q.episode === r.episode)).map((r) => ({
      remoteId: r.url, release: r.release_name || r.name || 'SubDL', language: q.language,
      format: SubtitleFormat.safeParse(win32.extname(r.url).slice(1).toLowerCase()).data ?? null,
      hashMatch: false, forced: false, sdh: r.hi ?? false, downloads: null, rating: null,
    }))
  }
  async download(candidate: SubtitleCandidate): Promise<SubtitlePayload> {
    let link: URL
    try { link = new URL(candidate.remoteId, this.downloadBase) }
    catch { throw new ApiProblem('subtitle_invalid_download', 'SubDL returned an invalid download address', 502) }
    return { bytes: await boundedBytes(await subtitleFetch(link, {}, [new URL(this.downloadBase).origin])), fileName: win32.basename(link.pathname) }
  }
}
