import { randomBytes } from 'node:crypto'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { DownloadClientState, DownloadClientStatus, DownloadFile, DownloadList, IndexerStatus, Release, ReleaseKind, ReleaseList, ReleaseQuery } from '@theama/contracts'
import type { CredentialStore } from '../metadata/credentials'
import { toItem } from './items'
import { ProwlarrClient, isDownloadLink, type IndexerHit, type ProwlarrConnection } from './prowlarr'
import { DownloadClientError, QBittorrentClient, type DownloadClientErrorKind, type QBittorrentConnection, type QBittorrentOptions } from './qbittorrent'
import { matchesQuery, parseRelease, rankReleases, type RawRelease } from './release'

const StoredConnection = z.object({ url: z.string(), username: z.string(), password: z.string() })
const StoredIndexer = z.object({ url: z.string(), apiKey: z.string() })

/** How many search hits are remembered for "download this one", and for how long. */
const RELEASE_CACHE_SIZE = 1000
const RELEASE_CACHE_MS = 30 * 60_000
/** Anything beyond this is noise; the list is already ranked. */
const MAX_RELEASES = 60

/** The tag every download added from Theama carries, so they can be told apart from the person's own. */
export const THEAMA_TAG = 'theama'

export interface DownloadsServiceOptions {
  /** Hold the connections as JSON in the secrets folder; never in the database. */
  store: CredentialStore
  indexerStore: CredentialStore
  logger: Logger
  /** The folder new downloads of this kind go to, or null to leave it to qBittorrent. */
  savePath?: (kind: ReleaseKind) => string | null
  /** Whether the person asked to see and manage every torrent in qBittorrent, not only the ones Theama added. */
  manageAll?: () => boolean
  http?: QBittorrentOptions
  now?: () => number
}

/** The release was found too long ago (or the service restarted since); the search has to be run again. */
export class ReleaseExpired extends Error {
  constructor() {
    super('That search has expired; search again')
    this.name = 'ReleaseExpired'
  }
}

/** The torrent has no file list yet (a magnet link whose details qBittorrent is still fetching). */
export class FilesNotReady extends Error {
  constructor() {
    super('qBittorrent is still fetching the file list; try again in a moment')
    this.name = 'FilesNotReady'
  }
}

export class InvalidFileSelection extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidFileSelection'
  }
}

/** The hash is not a download Theama may touch: not one it added (unless managing all) or not in qBittorrent at all. */
export class DownloadNotFound extends Error {
  constructor() {
    super('No such download')
    this.name = 'DownloadNotFound'
  }
}

interface CachedRelease {
  link: string
  at: number
}

/** Owns the qBittorrent and Prowlarr connections, searches for releases and hands the chosen one to qBittorrent. */
export class DownloadsService {
  readonly qbittorrent: QBittorrentClient
  readonly prowlarr: ProwlarrClient
  private readonly releases = new Map<string, CachedRelease>()
  private readonly now: () => number

  constructor(private readonly options: DownloadsServiceOptions) {
    this.qbittorrent = new QBittorrentClient(() => this.connection(), options.http)
    this.prowlarr = new ProwlarrClient(() => this.indexerConnection(), options.http)
    this.now = options.now ?? Date.now
  }

  connection(): QBittorrentConnection | null {
    return readStored(this.options.store, StoredConnection)
  }

  indexerConnection(): ProwlarrConnection | null {
    return readStored(this.options.indexerStore, StoredIndexer)
  }

  async status(): Promise<DownloadClientStatus> {
    const conn = this.connection()
    if (!conn) return statusOf('not_configured', null)
    return this.probe(this.qbittorrent, conn)
  }

  /**
   * Tests the connection first and only keeps it if qBittorrent accepts it. A qBittorrent that is simply not
   * running yet is not a reason to refuse: the details are kept and the status says it is unreachable.
   */
  async connect(next: QBittorrentConnection | null): Promise<DownloadClientStatus> {
    if (next === null) {
      this.options.store.set(null)
      this.options.logger.info('qBittorrent connection removed')
      return statusOf('not_configured', null)
    }
    const status = await this.probe(new QBittorrentClient(() => next, this.options.http), next)
    if (status.state === 'auth_failed' || status.state === 'forbidden') return status
    this.options.store.set(JSON.stringify(next))
    this.options.logger.info({ url: next.url, state: status.state }, 'qBittorrent connection saved')
    return status
  }

  async indexerStatus(): Promise<IndexerStatus> {
    const conn = this.indexerConnection()
    if (!conn) return indexerStatusOf('not_configured', null)
    return this.probeIndexer(this.prowlarr, conn)
  }

  /** Same rule as `connect`: a rejected key is refused, an indexer that is not running yet is saved. */
  async connectIndexer(next: ProwlarrConnection | null): Promise<IndexerStatus> {
    if (next === null) {
      this.options.indexerStore.set(null)
      this.options.logger.info('Prowlarr connection removed')
      return indexerStatusOf('not_configured', null)
    }
    const status = await this.probeIndexer(new ProwlarrClient(() => next, this.options.http), next)
    if (status.state === 'auth_failed' || status.state === 'forbidden') return status
    this.options.indexerStore.set(JSON.stringify(next))
    this.options.logger.info({ url: next.url, state: status.state }, 'Prowlarr connection saved')
    return status
  }

  /**
   * Looks for releases of a title. Prowlarr is preferred when set up (its results are better); otherwise the search
   * plugins inside qBittorrent are used. Hits that are not the title asked for are dropped, the rest ranked.
   */
  async findReleases(q: ReleaseQuery): Promise<ReleaseList> {
    const source = q.source ?? (this.indexerConnection() ? 'prowlarr' : 'qbittorrent')
    const text = searchText(q)
    let hits: IndexerHit[]
    if (source === 'prowlarr') {
      hits = await this.prowlarr.search(text)
    } else {
      hits = (await this.qbittorrent.search(text)).map((h) => ({ ...h, indexer: h.site }))
    }
    const kept: (RawRelease & { link: string })[] = []
    for (const h of hits) {
      if (!isDownloadLink(h.link)) continue
      const parsed = parseRelease(h.title)
      if (!q.unmatched && !matchesQuery(h.title, parsed, q)) continue
      kept.push({ title: h.title, size: h.size, seeders: h.seeders, leechers: h.leechers, indexer: h.indexer, link: h.link, ...parsed })
    }
    const items = rankReleases(kept).slice(0, MAX_RELEASES).map(({ link, ...release }): Release => ({ id: this.remember(link), ...release }))
    this.options.logger.info({ source, query: text, received: hits.length, kept: kept.length }, 'Release search finished')
    return { source, items, received: hits.length }
  }

  /** Hands a release found by `findReleases` to qBittorrent. Only those links are ever accepted, never a typed-in one. */
  async download(releaseId: string, kind: ReleaseKind): Promise<void> {
    const entry = this.releases.get(releaseId)
    if (!entry || this.now() - entry.at > RELEASE_CACHE_MS) {
      this.releases.delete(releaseId)
      throw new ReleaseExpired()
    }
    await this.qbittorrent.add(entry.link, { savePath: this.options.savePath?.(kind) ?? null, tags: [THEAMA_TAG, `${THEAMA_TAG}-${kind}`] })
    this.options.logger.info({ kind }, 'Download added to qBittorrent')
  }

  /** The downloads Theama added; every torrent only when the person turned on managing all of them. */
  async list(): Promise<DownloadList> {
    if (!this.connection()) return { reachable: false, items: [] }
    try {
      const torrents = await this.qbittorrent.torrents(this.scope())
      return { reachable: true, items: torrents.map((t) => toItem(t, THEAMA_TAG)).sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '')) }
    } catch (err) {
      if (err instanceof DownloadClientError) return { reachable: false, items: [] }
      throw err
    }
  }

  async setPaused(hash: string, paused: boolean): Promise<void> {
    await this.owned(hash)
    await this.qbittorrent.setPaused([hash], paused)
  }

  async remove(hash: string, deleteFiles: boolean): Promise<void> {
    await this.owned(hash)
    await this.qbittorrent.remove([hash], deleteFiles)
    this.options.logger.info({ deleteFiles }, 'Download removed from qBittorrent')
  }

  /** The files of a torrent and which are wanted. Empty while a magnet link's details are still being fetched. */
  async files(hash: string): Promise<DownloadFile[]> {
    await this.owned(hash)
    return (await this.qbittorrent.files(hash)).map((f) => ({ index: f.index, name: f.name, size: f.size, progress: f.progress, wanted: f.priority > 0 }))
  }

  /** Downloads exactly these files and skips the rest. Files already wanted keep their (possibly raised) priority. */
  async selectFiles(hash: string, wanted: number[]): Promise<void> {
    await this.owned(hash)
    const files = await this.qbittorrent.files(hash)
    if (files.length === 0) throw new FilesNotReady()
    const all = new Set(files.map((f) => f.index))
    const chosen = new Set(wanted)
    if (wanted.some((i) => !all.has(i))) throw new InvalidFileSelection('That file is not in this torrent')
    const byIndex = new Map(files.map((f) => [f.index, f]))
    const skip = files.filter((f) => !chosen.has(f.index) && f.priority > 0).map((f) => f.index)
    const enable = [...chosen].filter((i) => (byIndex.get(i)?.priority ?? 0) === 0)
    await this.qbittorrent.setFilePriority(hash, skip, 0)
    await this.qbittorrent.setFilePriority(hash, enable, 1)
    this.options.logger.info({ wanted: chosen.size, skipped: skip.length }, 'Download files chosen')
  }

  private scope(): { tag?: string } {
    return this.options.manageAll?.() ? {} : { tag: THEAMA_TAG }
  }

  /** Whether this hash is a torrent we may act on: one of ours, or any when managing all. */
  private async owned(hash: string): Promise<void> {
    const found = await this.qbittorrent.torrents({ ...this.scope(), hashes: [hash] })
    if (!found.some((t) => t.hash === hash.toLowerCase())) throw new DownloadNotFound()
  }

  private remember(link: string): string {
    const now = this.now()
    for (const [id, entry] of this.releases) {
      if (now - entry.at > RELEASE_CACHE_MS || this.releases.size >= RELEASE_CACHE_SIZE) this.releases.delete(id)
      else break // Insertion order is age order, so the rest are younger.
    }
    const id = randomBytes(9).toString('base64url')
    this.releases.set(id, { link, at: now })
    return id
  }

  private async probe(client: QBittorrentClient, conn: QBittorrentConnection): Promise<DownloadClientStatus> {
    try {
      // One after the other: the first call logs in and the second reuses that session.
      const version = await client.version()
      const webApiVersion = await client.webApiVersion()
      return { ...statusOf('connected', conn), version, webApiVersion }
    } catch (err) {
      if (!(err instanceof DownloadClientError)) throw err
      return { ...statusOf(stateOf(err.kind), conn), message: err.message }
    }
  }

  private async probeIndexer(client: ProwlarrClient, conn: ProwlarrConnection): Promise<IndexerStatus> {
    try {
      return { ...indexerStatusOf('connected', conn), version: await client.version() }
    } catch (err) {
      if (!(err instanceof DownloadClientError)) throw err
      return { ...indexerStatusOf(stateOf(err.kind), conn), message: err.message }
    }
  }
}

function readStored<T>(store: CredentialStore, schema: z.ZodType<T>): T | null {
  const raw = store.get()
  if (!raw) return null
  try {
    return schema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

const STATES: Record<DownloadClientErrorKind, DownloadClientState> = { unreachable: 'unreachable', auth: 'auth_failed', forbidden: 'forbidden', unavailable: 'unreachable' }
const stateOf = (kind: DownloadClientErrorKind): DownloadClientState => STATES[kind]

function statusOf(state: DownloadClientState, conn: QBittorrentConnection | null): DownloadClientStatus {
  return { state, url: conn?.url ?? null, username: conn?.username ?? null, version: null, webApiVersion: null, message: null }
}

function indexerStatusOf(state: DownloadClientState, conn: ProwlarrConnection | null): IndexerStatus {
  return { state, url: conn?.url ?? null, version: null, message: null }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** What goes in the search box: `Dune 2021`, `Severance S01E02`, `Severance S01`. */
export function searchText(q: ReleaseQuery): string {
  if (q.kind === 'movie') return q.year === undefined ? q.title : `${q.title} ${q.year}`
  if (q.season === undefined) return q.title
  return `${q.title} S${pad(q.season)}${q.episode === undefined ? '' : `E${pad(q.episode)}`}`
}
