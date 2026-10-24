import { randomUUID } from 'node:crypto'
import { open, stat, unlink } from 'node:fs/promises'
import { win32, basename, dirname, extname, join } from 'node:path'
import { z } from 'zod'
import { SubtitleProviderId, type SubtitleProviders, type SubtitleSearchResults, type SubtitleSearchRequest, type SubtitleDownloadResult } from '@theama/contracts'
import { ApiProblem, withTimeout } from '../library/sources'
import type { CredentialStore } from '../metadata/credentials'
import { subtitleContents, type SubtitleContent } from './content'
import { OpenSubtitlesProvider } from './opensubtitles'
import type { SubtitleCandidate, SubtitleProvider, SubtitleQuery } from './provider'
import { SubdlProvider } from './subdl'

const Credentials = z.object({ apiKey: z.string().min(1), username: z.string().optional(), password: z.string().optional() })
type Credentials = z.infer<typeof Credentials>
export interface SubtitleFile extends Omit<SubtitleQuery, 'language'> { available: boolean; guessedTitle?: string }
export interface SubtitleServiceDeps {
  store: CredentialStore
  file(id: number): SubtitleFile | null
  openSubtitlesBase?: string
  subdlBase?: string
  subdlDownloadBase?: string
  now?: () => number
}
interface CachedResult {
  expires: number
  fileId: number
  path: string
  provider: SubtitleProviderId
  candidate: SubtitleCandidate
  contents?: Promise<SubtitleContent[]>
}
export const SUBTITLE_RESULT_TTL = 20 * 60 * 1000

/** Deterministic release-name similarity used only for ordering, never presented as a timing guarantee. */
export function releaseSimilarity(videoPath: string, release: string): number {
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const a = tokens(win32.basename(videoPath, win32.extname(videoPath)))
  const b = tokens(release)
  const common = [...a].filter((v) => b.has(v)).length
  return common / Math.max(1, new Set([...a, ...b]).size)
}

export class SubtitleService {
  private saved: Partial<Record<SubtitleProviderId, Credentials>> = {}
  private readonly results = new Map<string, CachedResult>()
  private readonly providers: Record<SubtitleProviderId, SubtitleProvider>
  private readonly opensubtitles: OpenSubtitlesProvider
  constructor(private readonly d: SubtitleServiceDeps) {
    try {
      const json = JSON.parse(d.store.get() ?? '{}') as unknown
      const parsed = z.object({ opensubtitles: Credentials.optional(), subdl: Credentials.optional() }).safeParse(json)
      if (parsed.success) this.saved = parsed.data
    } catch { /* Missing or damaged credentials leave providers unconfigured. */ }
    this.opensubtitles = new OpenSubtitlesProvider(() => this.saved.opensubtitles ?? null, d.openSubtitlesBase)
    this.providers = { opensubtitles: this.opensubtitles, subdl: new SubdlProvider(() => this.saved.subdl?.apiKey ?? null, d.subdlBase, d.subdlDownloadBase) }
  }
  private now(): number { return this.d.now?.() ?? Date.now() }
  status(): SubtitleProviders {
    return { providers: SubtitleProviderId.options.map((id) => ({ id, configured: Boolean(this.saved[id]), loggedIn: Boolean(this.saved[id]?.username) })) }
  }
  secrets(): string[] {
    return [...Object.values(this.saved).flatMap((c) => [c.apiKey, c.username ?? '', c.password ?? '']), ...this.opensubtitles.secrets()]
  }
  private persist(): void {
    this.d.store.set(Object.keys(this.saved).length ? JSON.stringify(this.saved) : null)
    this.opensubtitles.reset()
    this.results.clear()
  }
  async setKey(id: SubtitleProviderId, apiKey: string | null): Promise<SubtitleProviders> {
    if (apiKey) {
      const temporary = id === 'opensubtitles'
        ? new OpenSubtitlesProvider(() => ({ apiKey }), this.d.openSubtitlesBase)
        : new SubdlProvider(() => apiKey, this.d.subdlBase, this.d.subdlDownloadBase)
      await temporary.test()
      this.saved[id] = { apiKey }
    } else delete this.saved[id]
    this.persist()
    return this.status()
  }
  async login(username: string, password: string): Promise<SubtitleProviders> {
    const previous = this.saved.opensubtitles
    if (!previous) throw new ApiProblem('subtitle_not_configured', 'Configure an OpenSubtitles API key first', 409)
    const next = { apiKey: previous.apiKey, username, password }
    const temporary = new OpenSubtitlesProvider(() => next, this.d.openSubtitlesBase)
    await temporary.login()
    this.saved.opensubtitles = next
    this.persist()
    this.opensubtitles.adoptSession(temporary)
    return this.status()
  }
  logout(): SubtitleProviders {
    if (this.saved.opensubtitles) this.saved.opensubtitles = { apiKey: this.saved.opensubtitles.apiKey }
    this.persist()
    return this.status()
  }
  async test(id: SubtitleProviderId): Promise<SubtitleProviders> { await this.providers[id].test(); return this.status() }
  private async file(id: number): Promise<SubtitleFile> {
    const file = this.d.file(id)
    if (!file) throw new ApiProblem('not_found', 'No such library file', 404)
    if (!file.available) throw new ApiProblem('subtitle_file_unavailable', 'The video or its drive is unavailable', 409)
    try { if (!(await withTimeout(stat(file.path))).isFile()) throw new Error() }
    catch { throw new ApiProblem('subtitle_file_unavailable', 'The video is no longer accessible', 409) }
    return file
  }
  async search(fileId: number, request: SubtitleSearchRequest): Promise<SubtitleSearchResults> {
    const file = await this.file(fileId)
    const requestedTitle = request.title.trim().toLocaleLowerCase()
    const edited = requestedTitle !== file.title.trim().toLocaleLowerCase() && requestedTitle !== file.guessedTitle?.trim().toLocaleLowerCase()
    const candidates = await this.providers[request.provider].search({ ...file, ...request, ...(edited ? { imdbId: null, tmdbId: null } : {}) })
    for (const [id, r] of this.results) if (r.expires <= this.now()) this.results.delete(id)
    const results = candidates.sort((a, b) => Number(b.hashMatch) - Number(a.hashMatch) || releaseSimilarity(file.path, b.release) - releaseSimilarity(file.path, a.release)).slice(0, 100).map((candidate) => {
      while (this.results.size >= 300) this.results.delete(this.results.keys().next().value!)
      const id = randomUUID()
      this.results.set(id, { fileId, path: file.path, provider: request.provider, candidate, expires: this.now() + SUBTITLE_RESULT_TTL })
      const { remoteId: _remoteId, ...hit } = candidate
      return { ...hit, id }
    })
    return { results }
  }
  async download(fileId: number, resultId: string, entryId?: string): Promise<SubtitleDownloadResult> {
    const result = this.results.get(resultId)
    if (!result || result.fileId !== fileId || result.expires <= this.now()) throw new ApiProblem('subtitle_stale_result', 'Search for subtitles again; this result has expired', 409)
    const current = await this.file(fileId)
    if (current.path !== result.path) throw new ApiProblem('subtitle_stale_result', 'The video moved. Search for subtitles again.', 409)
    // Keep decoded downloads bounded as well as search metadata (at most eight 8-MiB archives).
    const cached = [...this.results].filter(([, r]) => r.contents && r !== result)
    while (cached.length >= 8) this.results.delete(cached.shift()![0])
    result.contents ??= this.providers[result.provider].download(result.candidate).then((payload) => subtitleContents(payload, result.candidate.language)).catch((err: unknown) => { result.contents = undefined; throw err })
    const contents = await result.contents
    if (contents.length > 1 && entryId === undefined) return { state: 'select', files: contents.map((c, i) => ({ id: String(i), fileName: c.fileName, format: c.format })) }
    const content = contents[entryId === undefined ? 0 : Number(entryId)]
    if (!content || (entryId !== undefined && !/^(0|[1-9]\d*)$/.test(entryId))) throw new ApiProblem('subtitle_stale_result', 'Choose a subtitle file from this download', 400)
    // Downloads may take seconds. Resolve the authoritative path again before creating any file.
    const file = await this.file(fileId)
    if (file.path !== result.path) throw new ApiProblem('subtitle_stale_result', 'The video moved. Search again.', 409)
    const { candidate } = result
    const suffix = `${candidate.language}${candidate.forced ? '.forced' : ''}${candidate.sdh ? '.sdh' : ''}.${content.format}`
    const fileName = `${basename(file.path, extname(file.path))}.${suffix}`
    const destination = join(dirname(file.path), fileName)
    let created = false
    try {
      const handle = await open(destination, 'wx')
      created = true
      try { await handle.writeFile(content.bytes) } finally { await handle.close() }
      return { state: 'saved', fileName }
    } catch (err) {
      if (created) await unlink(destination).catch(() => undefined)
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new ApiProblem('subtitle_exists', 'A subtitle with this filename already exists; it has been preserved', 409)
      throw new ApiProblem('subtitle_write_failed', 'Could not save the subtitle. Check the drive and folder permissions.', 409)
    }
  }
}
