import type { Logger } from 'pino'
import type {
  MatchCandidate,
  MatchKind,
  Suggestion,
  MetadataLanguage,
  MetadataState,
  MetadataStatus,
  MetadataSuggestionDetails,
  MetadataSuggestionsResult,
  MetadataPersonTitlesResult,
  GenreList,
  GenreMode,
  ServerEvent,
  SuggestionSection,
} from '@theama/contracts'
import { GENRE_SEPARATOR } from '@theama/contracts'
import type { CollectionRepo } from '../collections/store'
import type { MediaFileRepo } from '../scan/store'
import { ArtworkCache, artworkUrl } from './artwork'
import type { CredentialStore } from './credentials'
import { decide, rank, type Decision, type ScoredCandidate } from './matcher'
import { AsyncCache } from './cache'
import { runPool } from '../scan/probe'
import { ProviderError, type MetadataProvider, type ProviderCandidate, type ProviderCollection, type ProviderEpisode } from './provider'
import { MetadataRepo, type PendingTitle } from './store'

const LANGUAGE_TAGS: Record<MetadataLanguage, string> = { en: 'en-US', el: 'el-GR' }
const DAY_MS = 24 * 60 * 60 * 1000
const BATCH = 25
/** Official collections change rarely; a stored one is re-read after this long (or when a member is refreshed by hand). */
const COLLECTION_FRESH_MS = 30 * DAY_MS
const SUGGESTION_FRESH_MS = 60 * 60 * 1000

export interface ManagerDeps {
  provider: MetadataProvider
  repo: MetadataRepo
  files: MediaFileRepo
  collections: CollectionRepo
  artwork: ArtworkCache
  credentials: CredentialStore
  language: () => MetadataLanguage
  emit: (event: ServerEvent) => void
  logger: Logger
  /** Called when the circuit breaker should be cleared (new credentials, "try again"). */
  resetProvider?: () => void
  now?: () => Date
  retryUnmatchedAfterMs?: number
  unavailableRetryMs?: number
  periodicMs?: number
}

export class MetadataProblem extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_key' | 'unavailable' | 'no_key',
    message: string,
  ) {
    super(message)
  }
}

/**
 * Finds out what each title in the library is. Runs in the background whenever there is something to
 * do (key added, files scanned, language changed), one title at a time, and never blocks browsing: the
 * library works from cached data whether or not the provider is reachable.
 */
export class MetadataManager {
  private state: MetadataState = 'idle'
  private message: string | null = null
  private current: string | null = null
  private running = false
  private rerun = false
  private stopped = false
  private retryTimer: NodeJS.Timeout | null = null
  private periodic: NodeJS.Timeout | null = null
  private lastChanged = 0
  private lastStatus = 0
  private idle: Promise<void> = Promise.resolve()
  /** Collections already read in the current pass, so three films of one set cost one request. */
  private readonly collectionsThisPass = new Set<string>()
  private readonly collectionFetches = new Map<string, Promise<void>>()
  private readonly collectionRefreshes = new Set<string>()
  private readonly collectionRetryAfter = new Map<string, number>()
  private readonly suggestionCache = new AsyncCache<MetadataSuggestionsResult>(128, SUGGESTION_FRESH_MS, () => this.now().getTime())
  private readonly suggestionDetailsCache = new AsyncCache<MetadataSuggestionDetails>(256, SUGGESTION_FRESH_MS, () => this.now().getTime())
  private readonly personTitlesCache = new AsyncCache<MetadataPersonTitlesResult>(128, SUGGESTION_FRESH_MS, () => this.now().getTime())

  constructor(private readonly d: ManagerDeps) {}

  private now(): Date {
    return this.d.now?.() ?? new Date()
  }

  private cutoff(): string {
    return new Date(this.now().getTime() - (this.d.retryUnmatchedAfterMs ?? 7 * DAY_MS)).toISOString()
  }

  private tag(): string {
    return LANGUAGE_TAGS[this.d.language()]
  }

  status(): MetadataStatus {
    const configured = this.d.credentials.has()
    const counts = this.d.repo.counts(this.cutoff())
    return {
      provider: 'tmdb',
      configured,
      state: configured ? (this.state === 'no_key' ? 'idle' : this.state) : 'no_key',
      pending: counts.pending,
      matched: counts.matched,
      ambiguous: counts.ambiguous,
      unmatched: counts.unmatched,
      current: this.state === 'working' ? this.current : null,
      message: this.state === 'unavailable' || this.state === 'invalid_key' ? this.message : null,
    }
  }

  private publish(force = false): void {
    const t = Date.now()
    if (!force && t - this.lastStatus < 250) return
    this.lastStatus = t
    this.d.emit({ type: 'metadata.status', status: this.status() })
  }

  private changed(force = false): void {
    const t = Date.now()
    if (!force && t - this.lastChanged < 2000) return
    this.lastChanged = t
    this.d.emit({ type: 'library.changed' })
  }

  start(): void {
    this.periodic = setInterval(() => this.kick(), this.d.periodicMs ?? 30 * 60_000)
    this.periodic.unref()
    this.d.repo.pruneOrphans()
    this.kick()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.periodic) clearInterval(this.periodic)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.d.provider.close()
    await this.idle
    await Promise.allSettled([...this.collectionFetches.values()])
  }

  /** Old cached sets render immediately; one background collection request supplies all member ratings. */
  refreshCollectionIfNeeded(id: number): void {
    if (this.stopped || !this.d.credentials.has()) return
    const ref = this.d.collections.ratingRefreshTarget(id)
    if (!ref || this.collectionRefreshes.has(ref.externalId) || (this.collectionRetryAfter.get(ref.externalId) ?? 0) > this.now().getTime()) return
    this.collectionRefreshes.add(ref.externalId)
    void this.storeCollection(ref).then(() => {
      this.collectionRetryAfter.delete(ref.externalId)
      this.changed(true)
    }).catch((err: unknown) => {
      this.collectionRetryAfter.set(ref.externalId, this.now().getTime() + 2 * 60_000)
      this.d.logger.warn({ err, collection: ref.name }, 'Could not refresh collection ratings; will retry later')
    }).finally(() => { this.collectionRefreshes.delete(ref.externalId) })
  }

  /** Asks for a pass over everything that needs looking up. Cheap to call often. */
  kick(): void {
    if (this.stopped) return
    if (this.running) {
      this.rerun = true
      return
    }
    this.running = true
    this.idle = this.pass().finally(() => {
      this.running = false
      if (this.rerun && !this.stopped) {
        this.rerun = false
        this.kick()
      }
    })
  }

  /** The key was added, replaced or removed. */
  credentialsChanged(): void {
    this.suggestionCache.clear()
    this.suggestionDetailsCache.clear()
    this.personTitlesCache.clear()
    this.d.resetProvider?.()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.state = this.d.credentials.has() ? 'idle' : 'no_key'
    this.message = null
    this.publish(true)
    this.kick()
  }

  /** "Try again now" after a failure, or a language change. */
  retryNow(): void {
    this.d.resetProvider?.()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.state === 'unavailable') this.state = 'idle'
    this.kick()
  }

  private async pass(): Promise<void> {
    if (!this.d.credentials.has()) {
      this.state = 'no_key'
      this.current = null
      this.publish(true)
      return
    }
    if (this.state === 'invalid_key') return // waits for new credentials
    this.state = 'working'
    this.message = null
    const failed = new Set<string>()
    this.collectionsThisPass.clear()
    try {
      for (;;) {
        if (this.stopped) return
        const pending = this.d.repo.pending(this.cutoff(), BATCH).filter((t) => !failed.has(t.key))
        const stale = this.d.repo.stale(this.d.language(), BATCH, this.now()).filter((s) => !failed.has(s.key))
        if (pending.length === 0 && stale.length === 0) break
        for (const t of pending) {
          if (this.stopped) return
          this.current = t.title
          this.publish()
          try {
            await this.lookUp(t)
          } catch (err) {
            if (err instanceof ProviderError && err.kind !== 'not_found') throw err
            failed.add(t.key)
            this.d.logger.warn({ err, title: t.title }, 'Could not identify a title; will try again later')
          }
        }
        for (const s of stale) {
          if (this.stopped) return
          this.current = s.key
          try {
            await this.fetchAndStore(s.key, s.kind, s.externalId, 'refresh')
          } catch (err) {
            if (err instanceof ProviderError && err.kind !== 'not_found') throw err
            failed.add(s.key)
            this.d.logger.warn({ err, key: s.key }, 'Could not refresh a title')
          }
        }
        this.changed()
      }
      await this.healArtwork()
      this.state = 'idle'
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'auth') {
        this.state = 'invalid_key'
        this.message = 'TMDB rejected the API key'
        this.d.logger.warn('TMDB rejected the API key; metadata lookups are paused until it is replaced')
      } else {
        this.state = 'unavailable'
        this.message = err instanceof Error ? err.message : 'The metadata provider is not reachable'
        this.d.logger.warn({ err }, 'The metadata provider is not reachable; will retry')
        this.scheduleRetry()
      }
    } finally {
      this.current = null
      this.changed(true)
      this.publish(true)
    }
  }

  private scheduleRetry(): void {
    if (this.stopped) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.retryNow(), this.d.unavailableRetryMs ?? 2 * 60_000)
    this.retryTimer.unref()
  }

  private toCandidate(c: ProviderCandidate, score: number | null, posterFile: string | null): MatchCandidate {
    return {
      provider: this.d.provider.id,
      externalId: c.externalId,
      kind: c.kind,
      title: c.title,
      originalTitle: c.originalTitle,
      year: c.year,
      overview: c.overview,
      posterUrl: artworkUrl(posterFile),
      score,
      rating: c.rating,
      genres: c.genres ?? [],
    }
  }

  private async candidatesWithPosters(scored: ScoredCandidate[], limit: number): Promise<MatchCandidate[]> {
    const out: MatchCandidate[] = []
    for (const s of scored.slice(0, limit)) {
      const file = await this.d.artwork.ensure(s.candidate.posterPath, 'thumb')
      out.push(this.toCandidate(s.candidate, s.score, file))
    }
    return out
  }

  private async searchAndDecide(t: PendingTitle): Promise<Decision> {
    const input = { kind: t.kind, title: t.title, year: t.year }
    const query = { kind: t.kind, title: t.title, language: this.tag() }
    let results = await this.d.provider.search({ ...query, year: t.year ?? undefined })
    let decision = decide(input, results)
    if (decision.state !== 'matched' && t.year !== null) {
      // The year in a file name is sometimes wrong; look again without it and judge the combined list.
      const more = await this.d.provider.search(query)
      const seen = new Set(results.map((r) => r.externalId))
      results = [...results, ...more.filter((m) => !seen.has(m.externalId))]
      decision = decide(input, results)
    }
    return decision
  }

  private async lookUp(t: PendingTitle): Promise<void> {
    const decision = await this.searchAndDecide(t)
    const when = this.now().toISOString()
    if (decision.state === 'matched') {
      const c = decision.best.candidate
      await this.fetchAndStore(t.key, t.kind, c.externalId, 'auto', { score: decision.best.score, signals: decision.best.signals })
      this.d.logger.info({ title: t.title, matchedTo: c.title, score: decision.best.score }, 'Title identified')
      return
    }
    const candidates = decision.state === 'ambiguous' ? await this.candidatesWithPosters(decision.ranked, 5) : []
    this.d.repo.saveMatch(
      {
        key: t.key,
        kind: t.kind,
        state: decision.state,
        score: decision.state === 'ambiguous' ? decision.best.score : null,
        candidates,
        decidedBy: 'auto',
      },
      when,
    )
    this.d.logger.info({ title: t.title, state: decision.state }, 'Title not identified automatically')
  }

  /** Fetches everything for one provider id and stores it. `how` says why: an automatic match, the user, or a refresh. */
  private async fetchAndStore(
    key: string,
    kind: MatchKind,
    externalId: string,
    how: 'auto' | 'user' | 'refresh',
    extra: { score?: number; signals?: unknown } = {},
  ): Promise<void> {
    const tag = this.tag()
    const title = await this.d.provider.fetchTitle(kind, externalId, tag)
    const episodes: ProviderEpisode[] = []
    if (kind === 'series') {
      for (const season of [...new Set(title.seasons)].slice(0, 60)) {
        episodes.push(...(await this.d.provider.fetchSeason(externalId, season, tag)))
      }
    }
    const poster = await this.d.artwork.ensure(title.posterPath, 'poster')
    const backdrop = await this.d.artwork.ensure(title.backdropPath, 'backdrop')
    const profiles = new Map<string, string>()
    for (const person of [...title.directors, ...title.cast]) {
      if (person.profilePath) profiles.set(person.externalId, person.profilePath)
    }
    const profileFiles = new Map<string, string | null>()
    for (const [id, path] of profiles) profileFiles.set(id, await this.d.artwork.ensure(path, 'thumb'))
    const when = this.now().toISOString()
    const existing = this.d.repo.getMatch(key)
    this.d.repo.atomic(() => {
      if (how !== 'refresh' || !existing) {
        this.d.repo.saveMatch(
          {
            key,
            kind,
            state: 'matched',
            provider: this.d.provider.id,
            externalId,
            score: how === 'user' ? 1 : (extra.score ?? null),
            signals: extra.signals,
            decidedBy: how === 'user' ? 'user' : 'auto',
            locked: how === 'user',
          },
          when,
        )
      }
      this.d.repo.saveMetadata(
        { key, provider: this.d.provider.id, language: this.d.language(), title, posterFile: poster, backdropFile: backdrop, profileFiles },
        episodes,
        new Map(),
        when,
      )
    })
    this.d.files.reindexTitle(key)
    if (kind === 'movie' && title.collection) await this.ensureCollection(title.collection, how !== 'auto')
  }

  /**
   * Reads the official collection a movie belongs to, so the Collections page can show the whole set and
   * name the parts the library lacks. Never fails the movie it came from: a missing set is retried later
   * (the movie then counts as stale again), a set the provider no longer has is stored empty.
   */
  private async ensureCollection(ref: { externalId: string; name: string }, force: boolean): Promise<void> {
    if (this.collectionsThisPass.has(ref.externalId)) return
    const id = this.d.provider.id
    const existing = this.d.collections.getOfficial(id, ref.externalId)
    const age = existing?.fetchedAt ? this.now().getTime() - new Date(existing.fetchedAt).getTime() : Infinity
    if (existing && !force && age < COLLECTION_FRESH_MS) return
    this.collectionsThisPass.add(ref.externalId)
    try {
      await this.storeCollection(ref)
    } catch (err) {
      this.collectionsThisPass.delete(ref.externalId)
      if (err instanceof ProviderError && err.kind === 'auth') throw err
      this.d.logger.warn({ err, collection: ref.name }, 'Could not read a collection; will try again later')
    }
    this.changed()
  }

  private async storeCollection(ref: { externalId: string; name: string }): Promise<void> {
    const existing = this.collectionFetches.get(ref.externalId)
    if (existing) return existing
    const task = (async () => {
      const provider = this.d.provider.id
      const when = this.now().toISOString()
      let collection: ProviderCollection
      try {
        collection = await this.d.provider.fetchCollection(ref.externalId, this.tag())
      } catch (err) {
        if (!(err instanceof ProviderError) || err.kind !== 'not_found') throw err
        collection = { externalId: ref.externalId, name: ref.name, overview: null, posterPath: null, backdropPath: null, parts: [] }
      }
      const parts = new Map<string, string | null>()
      for (const part of collection.parts) parts.set(part.externalId, await this.d.artwork.ensure(part.posterPath, 'poster'))
      this.d.collections.upsertOfficial(provider, collection, {
        poster: await this.d.artwork.ensure(collection.posterPath, 'poster'),
        backdrop: await this.d.artwork.ensure(collection.backdropPath, 'backdrop'),
        parts,
      }, when)
    })()
    this.collectionFetches.set(ref.externalId, task)
    try { await task } finally { this.collectionFetches.delete(ref.externalId) }
  }

  /** Downloads images that earlier attempts could not get (offline CDN, interrupted run). */
  private async healArtwork(): Promise<void> {
    for (const a of this.d.repo.missingArtwork(50)) {
      const poster = a.needPoster ? await this.d.artwork.ensure(a.posterPath, 'poster') : null
      const backdrop = a.needBackdrop ? await this.d.artwork.ensure(a.backdropPath, 'backdrop') : null
      this.d.repo.setArtworkFiles(a.key, poster, backdrop)
    }
    for (const a of this.d.collections.missingArtwork(50)) {
      const file = await this.d.artwork.ensure(a.path, a.target === 'collection_backdrop' ? 'backdrop' : 'poster')
      if (file) this.d.collections.setArtworkFile(a.target, a.id, file)
    }
    // Episode stills are fetched last and in the background: they are nice to have, not needed to browse.
    for (let round = 0; round < 40 && !this.stopped; round++) {
      const stills = this.d.repo.missingStills(25)
      if (stills.length === 0) break
      let got = 0
      for (const s of stills) {
        const file = await this.d.artwork.ensure(s.stillPath, 'still')
        if (file) {
          this.d.repo.setStillFile(s.key, s.season, s.episode, file)
          got++
        }
      }
      if (got === 0) break
    }
    this.changed()
  }

  // --- user actions -------------------------------------------------------

  private requireKey(): void {
    if (!this.d.credentials.has()) throw new MetadataProblem('no_key', 'Add a TMDB API key in Settings first')
  }

  private translate(err: unknown): never {
    if (err instanceof ProviderError) {
      if (err.kind === 'auth') {
        this.state = 'invalid_key'
        this.message = 'TMDB rejected the API key'
        this.publish(true)
        throw new MetadataProblem('invalid_key', 'TMDB rejected the API key')
      }
      if (err.kind === 'not_found') throw new MetadataProblem('not_found', 'TMDB has no such title')
      throw new MetadataProblem('unavailable', err.message)
    }
    throw err
  }

  /** Free-text search for the "identify" dialog. */
  async search(kind: MatchKind, query: string, year?: number): Promise<Suggestion[]> {
    this.requireKey()
    try {
      const results = await this.d.provider.search({ kind, title: query, year, language: this.tag() })
      const ranked = rank({ kind, title: query, year: year ?? null }, results).slice(0, 10)
      const candidates = await this.candidatesWithPosters(ranked, 10)
      return candidates.map((c, i) => ({ ...c, rating: ranked[i]!.candidate.rating }))
    } catch (err) {
      return this.translate(err)
    }
  }

  /** The provider's complete genre catalog, independent of the library or loaded suggestion pages. */
  async genres(): Promise<GenreList> {
    this.requireKey()
    try {
      return { genres: await this.d.provider.genres(this.tag()) }
    } catch (err) {
      return this.translate(err)
    }
  }

  /** One page of popular movies and series, remembered for an hour for each set of filters. */
  async suggestions(q: { section: SuggestionSection; year?: number | undefined; page: number; genres?: string | undefined; genreMode?: GenreMode | undefined }): Promise<MetadataSuggestionsResult> {
    this.requireKey()
    const language = this.tag()
    const today = this.now().toISOString().slice(0, 10)
    // The date is part of the key so "new" moves on at midnight.
    const genres = [...new Set((q.genres ?? '').split(GENRE_SEPARATOR).map((genre) => genre.trim()).filter(Boolean))].sort()
    const genreMode = genres.length > 1 ? q.genreMode ?? 'any' : 'any'
    const cacheKey = JSON.stringify([q.section, q.year, q.page, language, today, genres, genreMode])
    return this.suggestionCache.get(cacheKey, async () => {
      try {
        const page = await this.d.provider.suggestions({ section: q.section, year: q.year, page: q.page, genres, genreMode, language, today })
        const items: MetadataSuggestionsResult['items'] = new Array(page.items.length)
        await runPool(page.items.map((candidate, index) => ({ candidate, index })), 4, async ({ candidate, index }) => {
          const file = await this.d.artwork.ensure(candidate.posterPath, 'thumb')
          items[index] = { ...this.toCandidate(candidate, null, file), rating: candidate.rating }
        })
        return { items, hasMore: page.hasMore }
      } catch (err) { return this.translate(err) }
    })
  }

  /** Popular movies and series for one actor or director, with locally cached artwork. */
  async personTitles(externalId: string, category: 'actor' | 'director'): Promise<MetadataPersonTitlesResult> {
    this.requireKey()
    const language = this.tag()
    return this.personTitlesCache.get(`${externalId}:${category}:${language}`, async () => {
      try {
        const candidates = await this.d.provider.personTitles(externalId, category, language)
        const items: Suggestion[] = new Array(candidates.length)
        await runPool(candidates.map((candidate, index) => ({ candidate, index })), 4, async ({ candidate, index }) => {
          const file = await this.d.artwork.ensure(candidate.posterPath, 'thumb')
          items[index] = { ...this.toCandidate(candidate, null, file), rating: candidate.rating }
        })
        return { items }
      } catch (err) { return this.translate(err) }
    })
  }

  /** The IMDb id and trailer of one suggestion. Asked for when the user wants them, since each is a call of its own. */
  async suggestionDetails(kind: MatchKind, externalId: string): Promise<MetadataSuggestionDetails> {
    this.requireKey()
    const language = this.tag()
    const cacheKey = `${kind}:${externalId}:${language}`
    return this.suggestionDetailsCache.get(cacheKey, async () => {
      try {
        const title = await this.d.provider.fetchTitle(kind, externalId, language)
        return { imdbId: title.imdbId, trailer: title.trailer }
      } catch (err) { return this.translate(err) }
    })
  }

  /** The user says what a title is. The match is locked, so rescans and refreshes never undo it. */
  async identify(key: string, kind: MatchKind, externalId: string): Promise<void> {
    this.requireKey()
    try {
      await this.fetchAndStore(key, kind, externalId, 'user')
    } catch (err) {
      return this.translate(err)
    }
    this.changed(true)
    this.publish(true)
  }

  /** Fetches fresh details for the current match without changing the match itself. */
  async refresh(key: string): Promise<void> {
    this.requireKey()
    const match = this.d.repo.getMatch(key)
    if (!match || match.state !== 'matched' || !match.externalId) throw new MetadataProblem('not_found', 'This title is not identified yet')
    try {
      await this.fetchAndStore(key, match.kind, match.externalId, 'refresh')
    } catch (err) {
      return this.translate(err)
    }
    this.changed(true)
  }

  /** "This is not it": removes the provider data and stops looking, until the user picks something. */
  clearMatch(key: string, kind: MatchKind): void {
    this.d.repo.atomic(() => {
      this.d.repo.clearMetadata(key)
      this.d.repo.saveMatch({ key, kind, state: 'unmatched', decidedBy: 'user', locked: true }, this.now().toISOString())
    })
    this.d.files.reindexTitle(key)
    this.changed(true)
    this.publish(true)
  }

  /** Lets automatic matching reconsider a title. An unlocked unmatched/ambiguous title is retried at once. */
  unlock(key: string): boolean {
    const ok = this.d.repo.setLocked(key, false, this.now().toISOString())
    if (ok) {
      const m = this.d.repo.getMatch(key)
      if (m && m.state !== 'matched') {
        this.d.repo.forget(key)
        this.kick()
      }
    }
    this.publish(true)
    return ok
  }
}
