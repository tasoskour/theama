import { createReadStream, existsSync } from 'node:fs'
import { win32 } from 'node:path'
import Fastify, { LogController } from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import type { Logger } from 'pino'
import { ZodError } from 'zod'
import {
  API_PREFIX,
  ProviderIdentity,
  SaveFavoriteRequest,
  AppSettingsPatch,
  AddMemberRequest,
  ClientErrorReport,
  RestoreRequest,
  RenameApplyRequest,
  RenamePreviewRequest,
  GroupTitlesRequest,
  ReclassifyTitleRequest,
  SetTitleWatchedRequest,
  SetWatchedRequest,
  ProgressRequest,
  CollectionDetailQuery,
  CollectionListQuery,
  CreateCollectionRequest,
  RenameCollectionRequest,
  ReorderRequest,
  CreateSourceRequest,
  CreateExclusionRequest,
  IdentifyRequest,
  MetadataSearchQuery,
  MetadataPersonTitlesQuery,
  AwardsQuery,
  MetadataSuggestionsQuery,
  MetadataSuggestionDetailsQuery,
  SetCredentialsRequest,
  SetDownloadClientRequest,
  SetIndexerRequest,
  type DownloadList,
  type DownloadFileList,
  SetDownloadFilesRequest,
  AddDownloadRequest,
  ReleaseQuery,
  type ReleaseList,
  type IndexerStatus,
  type DownloadClientStatus,
  TitleKeyRequest,
  LogQuery,
  MediaFileQuery,
  TitleQuery,
  GenreQuery,
  RelocateSourceRequest,
  UpdateSourceRequest,
  type LibrarySource,
  type LibrarySourceList,
  type LibraryExclusion,
  type LibraryExclusionList,
  type BackupInfo,
  type BackupList,
  type CollectionDetail,
  type OperationBatch,
  type OperationList,
  type RenameApplyResult,
  type RenamePreview,
  type ContinueList,
  type ProgressResult,
  type GenreList,
  type FileSubtitles,
  type LaunchInfo,
  type CollectionList,
  type LibraryStatus,
  type MetadataSearchResult,
  type MetadataPersonTitlesResult,
  type AwardsResult,
  type MetadataSuggestionsResult,
  type MetadataSuggestionDetails,
  type MetadataStatus,
  type GroupTitlesResult,
  type ReclassifyTitleResult,
  type RemoveTitleResult,
  type MediaFilePage,
  type TitleDetail,
  type TitlePage,
  type ScanJob,
  type ScanJobList,
  type ApiError,
  type HealthResponse,
  type LogPage,
  type ServiceEventList,
  type SystemInfo,
  WATCHED_FRACTION,
} from '@theama/contracts'
import { pruneLogs, readServiceOutput } from '@theama/logs'
import { BackgroundReader } from './background/runner'
import { z } from 'zod'
import type { ServerConfig } from './config'
import type { LogHub } from './log/hub'
import type { SettingsRepo } from './repo/settings'
import type { ServiceEventRepo } from './repo/service-events'
import type { EventsHub } from './events-hub'
import { ARTWORK_FILE, artworkContentType, type ArtworkCache } from './metadata/artwork'
import type { CredentialStore } from './metadata/credentials'
import { DownloadClientError } from './downloads/qbittorrent'
import type { DownloadMonitor } from './downloads/monitor'
import type { FavoritesRepo } from './downloads/favorites'
import { DownloadNotFound, FilesNotReady, InvalidFileSelection, ReleaseExpired, type DownloadsService } from './downloads/service'
import type { AwardsService } from './metadata/awards'
import { MetadataProblem, type MetadataManager } from './metadata/manager'
import { normaliseTitle } from './scan/filename'
import { ProviderError, type MetadataProvider } from './metadata/provider'
import type { AutoScanner } from './scan/auto'
import type { ScanManager } from './scan/manager'
import type { MediaFileRepo, ScanJobRepo } from './scan/store'
import type { TitleRepo } from './scan/titles'
import { CollectionProblem, type CollectionRepo } from './collections/store'
import { PlaybackProblem, type PlaybackRepo } from './playback/store'
import { BackupProblem, type BackupService } from './backup/backup'
import { buildReport } from './diagnostics/report'
import type { FileJournal } from './files/journal'
import { RenameProblem, type RenameService } from './files/rename'
import { TemplateError, validateTemplate } from './files/template'
import { chooseSubtitle, discoverExternal } from './subtitles/discover'
import type { SubtitleService } from './subtitles/service'
import { registerSubtitleRoutes } from './subtitles/routes'
import { assertRelocatable } from './library/relocate'
import { ApiProblem, LibrarySourceRepo, normaliseFolderPath, probeFolder, refreshAvailability, withTimeout } from './library/sources'
import type { LibraryExclusionRepo } from './library/exclusions'
import { extractBearer, isAllowedOrigin, isLoopbackHost, tokenMatches } from './security'
import { APP_VERSION } from './version'

export interface AppDeps {
  config: ServerConfig
  logger: Logger
  logHub: LogHub
  settings: SettingsRepo
  serviceEvents: ServiceEventRepo
  library: LibrarySourceRepo
  exclusions: LibraryExclusionRepo
  files: MediaFileRepo
  titles: TitleRepo
  collections: CollectionRepo
  playback: PlaybackRepo
  renamer: RenameService
  journal: FileJournal
  backups: BackupService
  ffprobeFound: boolean
  jobs: ScanJobRepo
  scans: ScanManager
  auto: AutoScanner
  metadata: MetadataManager
  awards: AwardsService
  credentials: CredentialStore
  subtitles: SubtitleService
  provider: MetadataProvider
  downloads: DownloadsService
  favorites: FavoritesRepo
  downloadMonitor: DownloadMonitor
  artwork: ArtworkCache
  events: EventsHub
  token: string
  startedAt: Date
  schemaVersion: number
}

function apiError(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } }
}

export async function buildApp(deps: AppDeps) {
  const logReader = new BackgroundReader()
  const { config, logger, logHub, settings, serviceEvents, library, exclusions, files, titles, collections, playback, renamer, journal, backups, ffprobeFound, jobs, scans, auto, metadata, awards, credentials, provider, downloads, downloadMonitor, artwork, events, token, startedAt } = deps
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 64 * 1024,
    // Title keys travel in the URL path; a personal video's key is its whole path, far past the default of 100.
    routerOptions: { maxParamLength: 4096 },
  })

  // Registered first so preflight (OPTIONS) is answered before auth runs.
  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin, config.allowedOrigins)),
    methods: ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  })
  await app.register(websocket)

  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return
    if (!isLoopbackHost(req.headers.host)) {
      return reply.code(403).send(apiError('forbidden_host', 'Host header must be a loopback address'))
    }
    if (!isAllowedOrigin(req.headers.origin, config.allowedOrigins)) {
      return reply.code(403).send(apiError('forbidden_origin', 'Origin is not allowed'))
    }
    if (!tokenMatches(extractBearer(req.headers.authorization), token)) {
      return reply.code(401).send(apiError('unauthorized', 'Missing or invalid API token'))
    }
  })

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send(apiError('invalid_request', 'Request validation failed', err.issues))
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500
    // An ApiProblem is a failure we named on purpose (e.g. a download client that is down), so its message is safe to show.
    const deliberate = err instanceof ApiProblem
    if (status >= 500 && !deliberate) logger.error({ err }, 'Unhandled request error')
    const message = err instanceof Error ? err.message : 'Bad request'
    const code = deliberate ? err.apiCode : status >= 500 ? 'internal_error' : 'bad_request'
    return reply.code(status).send(apiError(code, status >= 500 && !deliberate ? 'Internal error' : message))
  })

  app.setNotFoundHandler((_req, reply) => reply.code(404).send(apiError('not_found', 'No such endpoint')))

  registerSubtitleRoutes(app, deps.subtitles)

  app.get(`${API_PREFIX}/health`, async (): Promise<HealthResponse> => ({
    status: 'ok',
    time: new Date().toISOString(),
  }))

  app.get(`${API_PREFIX}/system/info`, async (): Promise<SystemInfo> => ({
    version: APP_VERSION,
    nodeVersion: process.version,
    pid: process.pid,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    hostMode: config.hostMode,
    paths: {
      dataDir: config.dataDir,
      databaseFile: config.databaseFile,
      cacheDir: config.cacheDir,
      logsDir: config.logsDir,
    },
    schemaVersion: deps.schemaVersion,
  }))

  app.get(`${API_PREFIX}/settings`, async () => settings.get())

  app.put(`${API_PREFIX}/settings`, async (req) => {
    const patch = AppSettingsPatch.parse(req.body ?? {})
    for (const t of [patch.renameMovieTemplate, patch.renameEpisodeTemplate]) {
      if (t === undefined) continue
      try {
        validateTemplate(t)
      } catch (err) {
        if (err instanceof TemplateError) throw new ApiProblem('invalid_template', err.message, 400)
        throw err
      }
    }
    const updated = settings.update(patch)
    if (patch.logRetentionDays !== undefined) pruneLogs(config.logsDir, updated.logRetentionDays)
    if (patch.logDetail !== undefined && !config.logLevelPinned) logger.level = updated.logDetail
    // Titles fetched in another language are refreshed in the background.
    if (patch.metadataLanguage !== undefined) metadata.kick()
    // Which torrents are listed depends on this switch.
    if (patch.downloadsShowAll !== undefined) downloadMonitor.nudge()
    events.broadcast({ type: 'settings.changed', settings: updated })
    return updated
  })

  const IdParams = z.object({ id: z.coerce.number().int().positive() })

  app.get(`${API_PREFIX}/library/sources`, async (): Promise<LibrarySourceList> => ({
    items: await refreshAvailability(library),
  }))

  app.post(`${API_PREFIX}/library/sources`, async (req, reply): Promise<LibrarySource> => {
    const body = CreateSourceRequest.parse(req.body ?? {})
    const path = normaliseFolderPath(body.path)
    const { volumeId } = await probeFolder(path)
    const source = library.create({ path, libraryType: body.libraryType, recursive: body.recursive, volumeId })
    logger.info({ sourceId: source.id, path, libraryType: source.libraryType }, 'Library folder added')
    events.broadcast({ type: 'library.changed' })
    scans.enqueue(source.id, 'folder added')
    auto.syncWatchers()
    return reply.code(201).send(source)
  })

  app.patch(`${API_PREFIX}/library/sources/:id`, async (req): Promise<LibrarySource> => {
    const { id } = IdParams.parse(req.params)
    const patch = UpdateSourceRequest.parse(req.body ?? {})
    const before = library.get(id)
    const source = library.update(id, patch)
    events.broadcast({ type: 'library.changed' })
    // Re-enabling a folder, or switching its type or recursion, changes what a scan would find.
    if (before && (patch.enabled === true && !before.enabled || (patch.libraryType !== undefined && patch.libraryType !== before.libraryType) || (patch.recursive !== undefined && patch.recursive !== before.recursive))) {
      if (source.enabled) scans.enqueue(id, 'folder settings changed')
    }
    auto.syncWatchers()
    return source
  })

  app.post(`${API_PREFIX}/library/sources/:id/relocate`, async (req): Promise<LibrarySource> => {
    const { id } = IdParams.parse(req.params)
    const { path: raw } = RelocateSourceRequest.parse(req.body ?? {})
    const source = library.get(id)
    if (!source) throw new ApiProblem('not_found', 'No such library folder', 404)
    const path = normaliseFolderPath(raw)
    assertRelocatable(source, path, library.list())
    const { volumeId } = await probeFolder(path)
    scans.cancelForSource(id)
    files.relocateSource(id, path, volumeId)
    logger.info({ sourceId: id, from: source.path, to: path }, 'Library folder relocated')
    const updated = library.get(id)!
    events.broadcast({ type: 'library.changed' })
    scans.enqueue(id, 'folder relocated')
    auto.syncWatchers()
    return updated
  })

  app.delete(`${API_PREFIX}/library/sources/:id`, async (req) => {
    const { id } = IdParams.parse(req.params)
    const existing = library.get(id)
    if (!existing) throw new ApiProblem('not_found', 'No such library folder', 404)
    scans.cancelForSource(id)
    if (!library.remove(id)) throw new ApiProblem('not_found', 'No such library folder', 404)
    auto.syncWatchers()
    logger.info({ sourceId: id, path: existing.path }, 'Library folder removed from Theama (files untouched)')
    events.broadcast({ type: 'library.changed' })
    return { deleted: true }
  })

  app.post(`${API_PREFIX}/library/sources/:id/scan`, async (req, reply): Promise<ScanJob> => {
    const { id } = IdParams.parse(req.params)
    if (!library.get(id)) throw new ApiProblem('not_found', 'No such library folder', 404)
    const job = scans.enqueue(id, 'requested by the user')
    if (!job) throw new ApiProblem('unavailable', 'The service is shutting down', 503)
    return reply.code(202).send(job)
  })

  app.get(`${API_PREFIX}/library/sources/:id/exclusions`, async (req): Promise<LibraryExclusionList> => {
    const { id } = IdParams.parse(req.params)
    if (!library.get(id)) throw new ApiProblem('not_found', 'No such library folder', 404)
    return { items: exclusions.list(id) }
  })

  app.post(`${API_PREFIX}/library/sources/:id/exclusions`, async (req, reply): Promise<LibraryExclusion> => {
    const { id } = IdParams.parse(req.params)
    const body = CreateExclusionRequest.parse(req.body ?? {})
    const path = normaliseFolderPath(body.path)
    if (body.kind === 'folder') await probeFolder(path)
    const exclusion = exclusions.create(id, path, body.kind)
    events.broadcast({ type: 'library.changed' })
    return reply.code(201).send(exclusion)
  })

  app.delete(`${API_PREFIX}/library/exclusions/:id`, async (req) => {
    const { id } = IdParams.parse(req.params)
    const removed = exclusions.remove(id)
    if (!removed) throw new ApiProblem('not_found', 'No such exclusion', 404)
    scans.enqueue(removed.sourceId, 'exclusion removed')
    events.broadcast({ type: 'library.changed' })
    return { deleted: true }
  })

  app.post(`${API_PREFIX}/library/titles/hide`, async (req): Promise<{ hidden: number }> => {
    const { key } = TitleKeyRequest.parse(req.body ?? {})
    const hidden = exclusions.hideTitle(key)
    if (hidden === 0) throw new ApiProblem('not_found', 'No such title', 404)
    events.broadcast({ type: 'library.changed' })
    return { hidden }
  })

  app.post(`${API_PREFIX}/library/titles/reclassify`, async (req): Promise<ReclassifyTitleResult> => {
    const body = ReclassifyTitleRequest.parse(req.body ?? {})
    const result = titles.reclassify(body.key, body.kind)
    if (!result) throw new ApiProblem('not_found', 'No such title', 404)
    logger.info({ key: body.key, kind: body.kind, affectedFileCount: result.affectedFileCount }, 'Title category changed (files untouched)')
    events.broadcast({ type: 'library.changed' })
    return result
  })

  app.post(`${API_PREFIX}/library/titles/group`, async (req): Promise<GroupTitlesResult> => {
    const body = GroupTitlesRequest.parse(req.body ?? {})
    if (normaliseTitle(body.title) === '') throw new ApiProblem('invalid_title', 'Give the series a name with letters or numbers in it', 400)
    const grouped = titles.group(body.keys, body.title)
    if (!grouped) throw new ApiProblem('not_found', 'No such title', 404)
    logger.info({ key: grouped.key, title: body.title, affectedFileCount: grouped.affectedFileCount }, 'Titles grouped into one series (files untouched)')
    events.broadcast({ type: 'library.changed' })
    if (!body.externalId) return { ...grouped, identified: false }
    // Grouping is already saved, so a provider failure is reported rather than thrown.
    try {
      await metadata.identify(grouped.key, 'series', body.externalId)
    } catch (err) {
      logger.warn({ key: grouped.key, externalId: body.externalId, err }, 'Grouped titles could not be identified')
      return { ...grouped, identified: false, identifyError: err instanceof Error ? err.message : String(err) }
    }
    logger.info({ key: grouped.key, externalId: body.externalId }, 'Grouped series identified by the user')
    return { ...grouped, identified: true }
  })

  app.delete(`${API_PREFIX}/library/titles/:key`, async (req): Promise<RemoveTitleResult> => {
    const { key } = z.object({ key: z.string().min(1).max(1000) }).parse(req.params)
    // A card whose key no longer exists (its file was renamed or re-keyed) is already gone: succeed, and let every list refresh.
    const result = titles.remove(key) ?? { removedFileCount: 0 }
    logger.info({ key, removedFileCount: result.removedFileCount }, 'Title removed from Theama (files untouched)')
    events.broadcast({ type: 'library.changed' })
    return result
  })

  app.post(`${API_PREFIX}/library/files/:id/hide`, async (req): Promise<{ hidden: number }> => {
    const { id } = IdParams.parse(req.params)
    const hidden = exclusions.hideFile(id)
    events.broadcast({ type: 'library.changed' })
    return { hidden }
  })

  app.get(`${API_PREFIX}/scans`, async (req): Promise<ScanJobList> => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query)
    return { items: jobs.list(limit) }
  })

  app.get(`${API_PREFIX}/scans/:id`, async (req): Promise<ScanJob> => {
    const { id } = IdParams.parse(req.params)
    const job = jobs.get(id)
    if (!job) throw new ApiProblem('not_found', 'No such scan', 404)
    return job
  })

  app.post(`${API_PREFIX}/scans/:id/cancel`, async (req): Promise<{ cancelled: boolean }> => {
    const { id } = IdParams.parse(req.params)
    if (!jobs.get(id)) throw new ApiProblem('not_found', 'No such scan', 404)
    return { cancelled: scans.cancel(id) }
  })

  app.get(`${API_PREFIX}/library/files`, async (req): Promise<MediaFilePage> => files.list(MediaFileQuery.parse(req.query)))

  app.get(`${API_PREFIX}/library/titles`, async (req): Promise<TitlePage> => titles.list(TitleQuery.parse(req.query)))

  app.get(`${API_PREFIX}/library/genres`, async (req): Promise<GenreList> => ({ genres: titles.genres(GenreQuery.parse(req.query).kind) }))

  app.get(`${API_PREFIX}/library/title`, async (req): Promise<TitleDetail> => {
    const { key } = z.object({ key: z.string().min(1).max(1000) }).parse(req.query)
    const detail = titles.detail(key)
    if (!detail) throw new ApiProblem('not_found', 'No such title', 404)
    return detail
  })

  // --- metadata ----------------------------------------------------------

  /** Maps the manager's failures to HTTP; a rejected provider key is a 400, never 401 (that means our own API token). */
  function metadataFailure(err: unknown): never {
    if (err instanceof MetadataProblem) {
      const status = { not_found: 404, invalid_key: 400, no_key: 409, unavailable: 503 }[err.code]
      const code = err.code === 'unavailable' ? 'provider_unavailable' : err.code
      throw new ApiProblem(code, err.message, status)
    }
    throw err
  }

  const findTitle = (key: string, kind: 'movie' | 'series') => {
    const detail = titles.detail(key)
    if (!detail) throw new ApiProblem('not_found', 'No such title', 404)
    if (detail.summary.kind !== kind) {
      throw new ApiProblem('wrong_kind', `This title is a ${detail.summary.kind === 'video' ? 'personal video' : detail.summary.kind}`, 400)
    }
    return detail
  }

  app.get(`${API_PREFIX}/metadata/status`, async (): Promise<MetadataStatus> => metadata.status())

  app.put(`${API_PREFIX}/metadata/credentials`, async (req): Promise<MetadataStatus> => {
    const { tmdbApiKey } = SetCredentialsRequest.parse(req.body ?? {})
    const previous = credentials.get()
    credentials.set(tmdbApiKey)
    if (tmdbApiKey !== null) {
      provider.reset()
      try {
        await provider.validate()
      } catch (err) {
        if (err instanceof ProviderError && err.kind === 'auth') {
          credentials.set(previous) // keep what worked
          throw new ApiProblem('invalid_key', 'TMDB did not accept this key', 400)
        }
        // Offline or TMDB down: keep the key and let the background pass report the state.
        logger.warn({ err }, 'Could not check the TMDB key right now; saved it anyway')
      }
    }
    logger.info({ configured: tmdbApiKey !== null }, 'Metadata credentials changed')
    metadata.credentialsChanged()
    return metadata.status()
  })

  // --- downloads (qBittorrent) ---

  app.get(`${API_PREFIX}/downloads/status`, async (): Promise<DownloadClientStatus> => downloads.status())

  app.get(`${API_PREFIX}/library/title-identities`, async () => ({ items: titles.identities() }))
  app.get(`${API_PREFIX}/downloads/favorites`, async () => ({ items: deps.favorites.list() }))
  app.put(`${API_PREFIX}/downloads/favorites`, async (req) => {
    const favorite = deps.favorites.save(SaveFavoriteRequest.parse(req.body))
    events.broadcast({ type: 'favorites.changed' })
    return favorite
  })
  app.delete(`${API_PREFIX}/downloads/favorites/:provider/:kind/:externalId`, async (req) => {
    const deleted = deps.favorites.remove(ProviderIdentity.parse(req.params))
    events.broadcast({ type: 'favorites.changed' })
    return { deleted }
  })

  // A wrong user name or password is a 400 (never 401: that means our own API token); a qBittorrent that is
  // merely not running is saved and reported through the status.
  app.put(`${API_PREFIX}/downloads/client`, async (req): Promise<DownloadClientStatus> => {
    const { qbittorrent } = SetDownloadClientRequest.parse(req.body ?? {})
    const status = await downloads.connect(qbittorrent)
    if (status.state === 'auth_failed') throw new ApiProblem('invalid_credentials', status.message ?? 'qBittorrent did not accept these credentials', 400)
    if (status.state === 'forbidden') throw new ApiProblem('client_forbidden', status.message ?? 'qBittorrent refused the connection', 403)
    return status
  })

  app.get(`${API_PREFIX}/downloads/indexer`, async (): Promise<IndexerStatus> => downloads.indexerStatus())

  app.put(`${API_PREFIX}/downloads/indexer`, async (req): Promise<IndexerStatus> => {
    const { prowlarr } = SetIndexerRequest.parse(req.body ?? {})
    const status = await downloads.connectIndexer(prowlarr)
    if (status.state === 'auth_failed') throw new ApiProblem('invalid_credentials', status.message ?? 'Prowlarr did not accept this API key', 400)
    return status
  })

  /** Maps the download client's failures to HTTP. None is a 401: that means our own API token. */
  function downloadFailure(err: unknown): never {
    if (err instanceof DownloadClientError) {
      const status = { unreachable: 503, auth: 400, forbidden: 403, unavailable: 502 }[err.kind]
      const code = { unreachable: 'client_unreachable', auth: 'invalid_credentials', forbidden: 'client_forbidden', unavailable: 'client_error' }[err.kind]
      throw new ApiProblem(code, err.message, status)
    }
    throw err
  }

  app.get(`${API_PREFIX}/downloads/releases`, async (req): Promise<ReleaseList> => {
    if ('source' in (req.query as Record<string, unknown>)) throw new ApiProblem('invalid_request', 'Release source selection has been removed; set up Prowlarr to search', 400)
    const q = ReleaseQuery.parse(req.query)
    if (!downloads.indexerConnection()) throw new ApiProblem('not_configured', 'Set up Prowlarr in Settings → Downloads to search releases', 409)
    try {
      return await downloads.findReleases(q)
    } catch (err) {
      return downloadFailure(err)
    }
  })

  app.post(`${API_PREFIX}/downloads`, async (req, reply) => {
    const { releaseId, kind } = AddDownloadRequest.parse(req.body ?? {})
    if (!downloads.connection()) throw new ApiProblem('not_configured', 'qBittorrent is not set up', 409)
    try {
      await downloads.download(releaseId, kind)
    } catch (err) {
      if (err instanceof ReleaseExpired) throw new ApiProblem('release_expired', err.message, 410)
      return downloadFailure(err)
    }
    downloadMonitor.nudge()
    return reply.code(201).send({ ok: true })
  })

  // The downloads Theama added, as qBittorrent reports them right now (open windows are also pushed changes).
  app.get(`${API_PREFIX}/downloads`, async (): Promise<DownloadList> => downloads.list())

  const HashParams = z.object({ hash: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i) })
  /** Runs an action on one of our downloads; a hash that is not ours is a 404, however it got here. */
  async function onDownload(hash: string, action: () => Promise<void>, changes = true): Promise<{ ok: true }> {
    try {
      await action()
    } catch (err) {
      if (err instanceof DownloadNotFound) throw new ApiProblem('not_found', err.message, 404)
      if (err instanceof FilesNotReady) throw new ApiProblem('files_not_ready', err.message, 409)
      if (err instanceof InvalidFileSelection) throw new ApiProblem('invalid_selection', err.message, 400)
      return downloadFailure(err)
    }
    if (changes) downloadMonitor.nudge()
    return { ok: true }
  }
  app.post(`${API_PREFIX}/downloads/:hash/pause`, async (req) => {
    const { hash } = HashParams.parse(req.params)
    return onDownload(hash, () => downloads.setPaused(hash, true))
  })
  app.post(`${API_PREFIX}/downloads/:hash/resume`, async (req) => {
    const { hash } = HashParams.parse(req.params)
    return onDownload(hash, () => downloads.setPaused(hash, false))
  })
  app.get(`${API_PREFIX}/downloads/:hash/files`, async (req): Promise<DownloadFileList> => {
    const { hash } = HashParams.parse(req.params)
    let files: DownloadFileList['files'] = []
    await onDownload(hash, async () => void (files = await downloads.files(hash)), false)
    return { files }
  })
  app.put(`${API_PREFIX}/downloads/:hash/files`, async (req) => {
    const { hash } = HashParams.parse(req.params)
    const { wanted } = SetDownloadFilesRequest.parse(req.body ?? {})
    return onDownload(hash, () => downloads.selectFiles(hash, wanted))
  })
  app.delete(`${API_PREFIX}/downloads/:hash`, async (req) => {
    const { hash } = HashParams.parse(req.params)
    const { deleteFiles } = z.object({ deleteFiles: z.enum(['true', 'false']).default('false') }).parse(req.query)
    return onDownload(hash, () => downloads.remove(hash, deleteFiles === 'true'))
  })

  app.post(`${API_PREFIX}/metadata/retry`, async(): Promise<MetadataStatus> => {
    metadata.retryNow()
    return metadata.status()
  })

  app.get(`${API_PREFIX}/metadata/search`, async (req): Promise<MetadataSearchResult> => {
    const q = MetadataSearchQuery.parse(req.query)
    try {
      return { items: await metadata.search(q.kind, q.q, q.year) }
    } catch (err) {
      return metadataFailure(err)
    }
  })

  app.get(`${API_PREFIX}/metadata/genres`, async (): Promise<GenreList> => {
    try {
      return await metadata.genres()
    } catch (err) {
      return metadataFailure(err)
    }
  })

  app.get(`${API_PREFIX}/metadata/person/titles`, async (req): Promise<MetadataPersonTitlesResult> => {
    const q = MetadataPersonTitlesQuery.parse(req.query)
    try {
      return await metadata.personTitles(q.externalId, q.category)
    } catch (err) { return metadataFailure(err) }
  })

  app.get(`${API_PREFIX}/metadata/awards`, async (req): Promise<AwardsResult> => {
    const q = AwardsQuery.parse(req.query)
    try {
      return await awards.awards(q.subject, q.externalId)
    } catch (err) {
      if (err instanceof ProviderError) throw new ApiProblem('provider_unavailable', err.message, 503)
      throw err
    }
  })

  app.get(`${API_PREFIX}/metadata/suggestions`, async (req): Promise<MetadataSuggestionsResult> => {
    const q = MetadataSuggestionsQuery.parse(req.query)
    try {
      return await metadata.suggestions(q)
    } catch (err) {
      return metadataFailure(err)
    }
  })

  app.get(`${API_PREFIX}/metadata/suggestions/details`, async (req): Promise<MetadataSuggestionDetails> => {
    const q = MetadataSuggestionDetailsQuery.parse(req.query)
    try {
      return await metadata.suggestionDetails(q.kind, q.externalId)
    } catch (err) {
      return metadataFailure(err)
    }
  })

  app.post(`${API_PREFIX}/library/title/identify`, async (req) => {
    const body = IdentifyRequest.parse(req.body ?? {})
    findTitle(body.key, body.kind)
    try {
      await metadata.identify(body.key, body.kind, body.externalId)
    } catch (err) {
      return metadataFailure(err)
    }
    logger.info({ key: body.key, externalId: body.externalId }, 'Title identified by the user')
    return titles.detail(body.key)
  })

  app.post(`${API_PREFIX}/library/title/refresh`, async (req) => {
    const { key } = TitleKeyRequest.parse(req.body ?? {})
    if (!titles.detail(key)) throw new ApiProblem('not_found', 'No such title', 404)
    try {
      await metadata.refresh(key)
    } catch (err) {
      return metadataFailure(err)
    }
    return titles.detail(key)
  })

  app.post(`${API_PREFIX}/library/title/clear-match`, async (req) => {
    const { key } = TitleKeyRequest.parse(req.body ?? {})
    const detail = titles.detail(key)
    if (!detail) throw new ApiProblem('not_found', 'No such title', 404)
    if (detail.summary.kind === 'video') throw new ApiProblem('wrong_kind', 'Personal videos are never identified', 400)
    metadata.clearMatch(key, detail.summary.kind)
    return titles.detail(key)
  })

  app.post(`${API_PREFIX}/library/title/unlock`, async (req) => {
    const { key } = TitleKeyRequest.parse(req.body ?? {})
    if (!titles.detail(key)) throw new ApiProblem('not_found', 'No such title', 404)
    metadata.unlock(key)
    return titles.detail(key)
  })

  app.get(`${API_PREFIX}/artwork/:file`, async (req, reply) => {
    const { file } = z.object({ file: z.string().regex(ARTWORK_FILE) }).parse(req.params)
    const path = artwork.pathOf(file)
    if (!path || !existsSync(path)) throw new ApiProblem('not_found', 'No such image', 404)
    return reply
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .type(artworkContentType(file))
      .send(createReadStream(path))
  })

  // --- collections --------------------------------------------------------

  /** Runs a collection change, turning the repository's refusals into API errors. */
  function collectionCall<T>(fn: () => T): T {
    try {
      return fn()
    } catch (err) {
      if (err instanceof CollectionProblem) {
        const status = { not_found: 404, not_editable: 403, unknown_title: 404, duplicate_name: 409, bad_order: 400 }[err.code]
        throw new ApiProblem(err.code, err.message, status)
      }
      throw err
    }
  }
  const collectionDetail = (id: number, order?: 'release' | 'custom'): CollectionDetail => {
    const d = collections.detail(id, order)
    if (!d) throw new ApiProblem('not_found', 'No such collection', 404)
    return d
  }
  const nowIso = (): string => new Date().toISOString()
  const KeyQuery = z.object({ key: z.string().min(1).max(1000) })

  app.get(`${API_PREFIX}/collections`, async (req): Promise<CollectionList> => ({
    items: (() => {
      const query = CollectionListQuery.parse(req.query)
      return collections.list(query.kind, query.q)
    })(),
  }))

  app.get(`${API_PREFIX}/collections/:id`, async (req): Promise<CollectionDetail> => {
    const { id } = IdParams.parse(req.params)
    return collectionDetail(id, CollectionDetailQuery.parse(req.query).order)
  })

  app.post(`${API_PREFIX}/collections`, async (req, reply): Promise<CollectionDetail> => {
    const body = CreateCollectionRequest.parse(req.body ?? {})
    const id = collectionCall(() => collections.create(body.name, nowIso(), body.key))
    logger.info({ collectionId: id }, 'Collection created')
    events.broadcast({ type: 'library.changed' })
    return reply.code(201).send(collectionDetail(id))
  })

  app.patch(`${API_PREFIX}/collections/:id`, async (req): Promise<CollectionDetail> => {
    const { id } = IdParams.parse(req.params)
    collectionCall(() => collections.rename(id, RenameCollectionRequest.parse(req.body ?? {}).name, nowIso()))
    events.broadcast({ type: 'library.changed' })
    return collectionDetail(id)
  })

  app.delete(`${API_PREFIX}/collections/:id`, async (req) => {
    const { id } = IdParams.parse(req.params)
    collectionCall(() => collections.remove(id))
    logger.info({ collectionId: id }, 'Collection deleted (titles untouched)')
    events.broadcast({ type: 'library.changed' })
    return { deleted: true }
  })

  app.post(`${API_PREFIX}/collections/:id/members`, async (req): Promise<CollectionDetail> => {
    const { id } = IdParams.parse(req.params)
    collectionCall(() => collections.addMember(id, AddMemberRequest.parse(req.body ?? {}).key, nowIso()))
    events.broadcast({ type: 'library.changed' })
    return collectionDetail(id, 'custom')
  })

  app.delete(`${API_PREFIX}/collections/:id/members`, async (req): Promise<CollectionDetail> => {
    const { id } = IdParams.parse(req.params)
    collectionCall(() => collections.removeMember(id, KeyQuery.parse(req.query).key, nowIso()))
    events.broadcast({ type: 'library.changed' })
    return collectionDetail(id, 'custom')
  })

  app.put(`${API_PREFIX}/collections/:id/order`, async (req): Promise<CollectionDetail> => {
    const { id } = IdParams.parse(req.params)
    collectionCall(() => collections.reorder(id, ReorderRequest.parse(req.body ?? {}).keys, nowIso()))
    events.broadcast({ type: 'library.changed' })
    return collectionDetail(id, 'custom')
  })

  // --- playback and subtitles ---------------------------------------------

  function playbackCall<T>(fn: () => T): T {
    try {
      return fn()
    } catch (err) {
      if (err instanceof PlaybackProblem) throw new ApiProblem(err.code, err.message, err.code === 'not_found' ? 404 : 409)
      throw err
    }
  }

  app.put(`${API_PREFIX}/playback/files/:id`, async (req) => {
    const { id } = IdParams.parse(req.params)
    const { watched } = SetWatchedRequest.parse(req.body ?? {})
    const changed = playback.setWatched([id], watched, nowIso())
    if (changed === 0) throw new ApiProblem('not_found', 'No such file', 404)
    events.broadcast({ type: 'library.changed' })
    return { changed }
  })

  app.put(`${API_PREFIX}/playback/titles`, async (req) => {
    const body = SetTitleWatchedRequest.parse(req.body ?? {})
    const changed = playbackCall(() => playback.setTitleWatched(body.key, body.watched, body.season, nowIso()))
    events.broadcast({ type: 'library.changed' })
    return { changed }
  })

  app.get(`${API_PREFIX}/playback/continue`, async (req): Promise<ContinueList> => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(60).default(20) }).parse(req.query)
    return { items: playback.continueWatching(limit) }
  })

  app.delete(`${API_PREFIX}/playback/continue/:key`, async (req) => {
    const { key } = z.object({ key: z.string().min(1).max(1000) }).parse(req.params)
    if (!playback.dismissContinue(key, nowIso())) throw new ApiProblem('not_found', 'No such title', 404)
    events.broadcast({ type: 'library.changed' })
    return { ok: true }
  })

  /** The desktop shell asks for this just before starting a player; it never takes a path from the UI. */
  app.get(`${API_PREFIX}/playback/files/:id/launch`, async (req): Promise<LaunchInfo> => {
    const { id } = IdParams.parse(req.params)
    const file = playback.fileForLaunch(id)
    if (!file) throw new ApiProblem('not_found', 'No such file', 404)
    if (file.sourceOffline) throw new ApiProblem('unavailable', 'This file is on a drive that cannot be reached right now', 409)
    if (!file.available) throw new ApiProblem('unavailable', 'This file is no longer where Theama last saw it', 409)
    const preferred = settings.get().subtitleLanguages
    const external = await withTimeout(discoverExternal(file.path), 3000).catch(() => [])
    const chosen = chooseSubtitle(external, preferred)
    return {
      fileId: file.id,
      path: file.path,
      fileName: win32.basename(file.path),
      title: file.title,
      kind: file.kind,
      subtitle: chosen ? { path: chosen.path, language: chosen.language } : null,
      subtitleLanguages: preferred,
      resumeSeconds: playback.resumeSeconds(id),
    }
  })

  app.post(`${API_PREFIX}/playback/files/:id/launched`, async (req) => {
    const { id } = IdParams.parse(req.params)
    playbackCall(() => playback.launched(id, nowIso()))
    events.broadcast({ type: 'library.changed' })
    return { ok: true }
  })

  /** Forwarded by the desktop shell while a player that can tell us its position is open. */
  app.put(`${API_PREFIX}/playback/files/:id/progress`, async (req): Promise<ProgressResult> => {
    const { id } = IdParams.parse(req.params)
    const body = ProgressRequest.parse(req.body ?? {})
    const outcome = playbackCall(() => playback.recordProgress(id, body.positionSeconds, body.durationSeconds, nowIso()))
    // Periodic saves stay quiet; lists refresh when the file turns watched or the viewing ends.
    if (outcome === 'watched' || (body.final && outcome !== 'ignored')) events.broadcast({ type: 'library.changed' })
    // When a viewing reaches the end, the desktop shell can offer the next episode (after a countdown).
    const { autoPlayNext, nextEpisodeCountdownSeconds } = settings.get()
    const finished = body.final && body.durationSeconds !== null && body.durationSeconds > 0 && body.positionSeconds >= body.durationSeconds * WATCHED_FRACTION
    const following = finished && autoPlayNext ? playback.followingEpisode(id) : null
    return following ? { outcome, nextUp: { ...following, countdownSeconds: nextEpisodeCountdownSeconds } } : { outcome }
  })

  app.get(`${API_PREFIX}/library/files/:id/subtitles`, async (req): Promise<FileSubtitles> => {
    const { id } = IdParams.parse(req.params)
    const file = playback.fileForLaunch(id)
    if (!file) throw new ApiProblem('not_found', 'No such file', 404)
    const preferred = settings.get().subtitleLanguages
    const external = file.available ? await withTimeout(discoverExternal(file.path), 3000).catch(() => []) : []
    return { embedded: playback.embeddedSubtitles(id), external, chosen: chooseSubtitle(external, preferred), preferred }
  })

  // --- renaming files -----------------------------------------------------

  async function renameCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof RenameProblem) throw new ApiProblem(err.code, err.message, err.code === 'not_found' ? 404 : 400)
      throw err
    }
  }
  const templates = () => ({ movie: settings.get().renameMovieTemplate, episode: settings.get().renameEpisodeTemplate })

  app.post(`${API_PREFIX}/files/rename/preview`, async (req): Promise<RenamePreview> =>
    renameCall(() => renamer.preview(RenamePreviewRequest.parse(req.body ?? {}), templates())),
  )

  app.post(`${API_PREFIX}/files/rename/apply`, async (req): Promise<RenameApplyResult> => {
    const result = await renameCall(() => renamer.apply(RenameApplyRequest.parse(req.body ?? {}), templates()))
    if (result.batch) events.broadcast({ type: 'library.changed' })
    return result
  })

  const BatchParams = z.object({ id: z.string().uuid() })

  app.get(`${API_PREFIX}/files/operations`, async (req): Promise<OperationList> => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(30) }).parse(req.query)
    return { items: journal.list(limit) }
  })

  app.get(`${API_PREFIX}/files/operations/:id`, async (req): Promise<OperationBatch> => {
    const batch = journal.batch(BatchParams.parse(req.params).id)
    if (!batch) throw new ApiProblem('not_found', 'No such batch of renames', 404)
    return batch
  })

  app.post(`${API_PREFIX}/files/operations/:id/rollback`, async (req): Promise<OperationBatch> => {
    const batch = await renamer.undo(BatchParams.parse(req.params).id)
    if (!batch) throw new ApiProblem('not_found', 'No such batch of renames', 404)
    events.broadcast({ type: 'library.changed' })
    return batch
  })

  // --- backups ------------------------------------------------------------

  async function backupCall<T>(fn: () => T): Promise<Awaited<T>> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof BackupProblem) {
        const status = { not_found: 404, invalid_backup: 422, newer_version: 422, bad_path: 400 }[err.code]
        throw new ApiProblem(err.code, err.message, status)
      }
      throw err
    }
  }
  const backupList = async (): Promise<BackupList> => ({ items: backups.list(), pending: await backups.pending(), directory: config.backupsDir })

  app.get(`${API_PREFIX}/backups`, async (): Promise<BackupList> => backupList())

  app.post(`${API_PREFIX}/backups`, async (_req, reply): Promise<BackupInfo> => reply.code(201).send(await backupCall(() => backups.create('manual'))))

  app.delete(`${API_PREFIX}/backups/:name`, async (req) => {
    const { name } = z.object({ name: z.string().min(1).max(200) }).parse(req.params)
    await backupCall(() => backups.remove(name))
    return { deleted: true }
  })

  /** Sets a restore aside. It takes effect at the next start of the service (the database is open now). */
  app.post(`${API_PREFIX}/backups/restore`, async (req): Promise<BackupList> => {
    const body = RestoreRequest.parse(req.body ?? {})
    await backupCall(() => backups.stage(body.name !== undefined ? { name: body.name } : { path: body.path! }))
    return backupList()
  })

  app.delete(`${API_PREFIX}/backups/restore`, async (): Promise<BackupList> => {
    await backups.cancelPending()
    return backupList()
  })

  // --- diagnostics (local only: nothing here is sent anywhere) --------------------

  /** At most this many interface errors are logged per minute, so a render loop cannot flood the log history. */
  const clientErrors = { windowStart: 0, count: 0 }
  app.post(`${API_PREFIX}/diagnostics/client-error`, async (req, reply) => {
    const report = ClientErrorReport.parse(req.body ?? {})
    const now = Date.now()
    if (now - clientErrors.windowStart > 60_000) Object.assign(clientErrors, { windowStart: now, count: 0 })
    if (++clientErrors.count > 30) return reply.code(202).send({ accepted: false })
    logger.error({ source: 'ui', kind: report.kind, where: report.where, stack: report.stack }, `The interface reported an error: ${report.message}`)
    return reply.code(202).send({ accepted: true })
  })

  app.get(`${API_PREFIX}/diagnostics/report`, async (_req, reply) => {
    const text = buildReport({
      info: {
        version: APP_VERSION,
        nodeVersion: process.version,
        pid: process.pid,
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
        hostMode: config.hostMode,
        paths: { dataDir: config.dataDir, databaseFile: config.databaseFile, cacheDir: config.cacheDir, logsDir: config.logsDir },
        schemaVersion: deps.schemaVersion,
      },
      library: scans.status(),
      metadata: metadata.status(),
      backups: backups.list(),
      serviceEvents: serviceEvents.list(20),
      ffprobeFound,
      logsDir: config.logsDir,
      secrets: [token, credentials.get(), downloads.connection()?.password ?? null, downloads.indexerConnection()?.apiKey ?? null, ...deps.subtitles.secrets()],
      now: new Date(),
    })
    return reply.type('text/plain; charset=utf-8').send(text)
  })

  app.get(`${API_PREFIX}/library/status`, async (): Promise<LibraryStatus> => scans.status())

  app.get(`${API_PREFIX}/logs`, async (req): Promise<LogPage> => {
    const query = LogQuery.parse(req.query)
    if (query.source === 'service-stdout' || query.source === 'service-stderr') {
      return { items: readServiceOutput(config.logsDir, query.source, query), nextCursor: null }
    }
    return logReader.logs(config.logsDir, query)
  })

  app.get(`${API_PREFIX}/service/events`, async (): Promise<ServiceEventList> => ({
    items: serviceEvents.list(100),
  }))

  app.get(`${API_PREFIX}/events`, { websocket: true }, (socket) => {
    events.add(socket)
    socket.send(JSON.stringify({ type: 'hello', version: APP_VERSION, time: new Date().toISOString() }))
  })

  logHub.subscribe((entry) => events.broadcast({ type: 'log.appended', entry }))

  app.addHook('onClose', () => logReader.close())
  return { app, events }
}

export type BuiltApp = Awaited<ReturnType<typeof buildApp>>
