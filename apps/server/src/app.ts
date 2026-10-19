import Fastify, { LogController } from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import type { Logger } from 'pino'
import { ZodError } from 'zod'
import {
  API_PREFIX,
  AppSettingsPatch,
  CreateSourceRequest,
  LogQuery,
  MediaFileQuery,
  TitleQuery,
  UpdateSourceRequest,
  type LibrarySource,
  type LibrarySourceList,
  type LibraryStatus,
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
} from '@theama/contracts'
import { pruneLogs, readAppLogs, readServiceOutput } from '@theama/logs'
import { z } from 'zod'
import type { ServerConfig } from './config'
import type { LogHub } from './log/hub'
import type { SettingsRepo } from './repo/settings'
import type { ServiceEventRepo } from './repo/service-events'
import type { EventsHub } from './events-hub'
import type { AutoScanner } from './scan/auto'
import type { ScanManager } from './scan/manager'
import type { MediaFileRepo, ScanJobRepo } from './scan/store'
import type { TitleRepo } from './scan/titles'
import { ApiProblem, LibrarySourceRepo, normaliseFolderPath, probeFolder, refreshAvailability } from './library/sources'
import { extractBearer, isAllowedOrigin, isLoopbackHost, tokenMatches } from './security'
import { APP_VERSION } from './version'

export interface AppDeps {
  config: ServerConfig
  logger: Logger
  logHub: LogHub
  settings: SettingsRepo
  serviceEvents: ServiceEventRepo
  library: LibrarySourceRepo
  files: MediaFileRepo
  titles: TitleRepo
  jobs: ScanJobRepo
  scans: ScanManager
  auto: AutoScanner
  events: EventsHub
  token: string
  startedAt: Date
  schemaVersion: number
}

function apiError(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } }
}

export async function buildApp(deps: AppDeps) {
  const { config, logger, logHub, settings, serviceEvents, library, files, titles, jobs, scans, auto, events, token, startedAt } = deps
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 64 * 1024,
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
    if (status >= 500) logger.error({ err }, 'Unhandled request error')
    const message = err instanceof Error ? err.message : 'Bad request'
    const code = err instanceof ApiProblem ? err.apiCode : status >= 500 ? 'internal_error' : 'bad_request'
    return reply.code(status).send(apiError(code, status >= 500 ? 'Internal error' : message))
  })

  app.setNotFoundHandler((_req, reply) => reply.code(404).send(apiError('not_found', 'No such endpoint')))

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
    const updated = settings.update(patch)
    if (patch.logRetentionDays !== undefined) pruneLogs(config.logsDir, updated.logRetentionDays)
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

  app.get(`${API_PREFIX}/library/title`, async (req): Promise<TitleDetail> => {
    const { key } = z.object({ key: z.string().min(1).max(1000) }).parse(req.query)
    const detail = titles.detail(key)
    if (!detail) throw new ApiProblem('not_found', 'No such title', 404)
    return detail
  })

  app.get(`${API_PREFIX}/library/status`, async (): Promise<LibraryStatus> => scans.status())

  app.get(`${API_PREFIX}/logs`, async (req): Promise<LogPage> => {
    const query = LogQuery.parse(req.query)
    if (query.source === 'service-stdout' || query.source === 'service-stderr') {
      return { items: readServiceOutput(config.logsDir, query.source, query), nextCursor: null }
    }
    return readAppLogs(config.logsDir, query)
  })

  app.get(`${API_PREFIX}/service/events`, async (): Promise<ServiceEventList> => ({
    items: serviceEvents.list(100),
  }))

  app.get(`${API_PREFIX}/events`, { websocket: true }, (socket) => {
    events.add(socket)
    socket.send(JSON.stringify({ type: 'hello', version: APP_VERSION, time: new Date().toISOString() }))
  })

  logHub.subscribe((entry) => events.broadcast({ type: 'log.appended', entry }))

  return { app, events }
}

export type BuiltApp = Awaited<ReturnType<typeof buildApp>>
