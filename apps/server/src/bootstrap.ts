import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { Logger } from 'pino'
import type { RuntimeInfo } from '@theama/contracts'
import { pruneLogs } from '@theama/logs'
import { buildApp } from './app'
import type { ServerConfig } from './config'
import { openDatabase } from './db/client'
import { createLogger } from './log/logger'
import { EventsHub } from './events-hub'
import { LibrarySourceRepo } from './library/sources'
import { CollectionRepo } from './collections/store'
import { FileJournal } from './files/journal'
import { RenameService } from './files/rename'
import { PlaybackRepo } from './playback/store'
import { ArtworkCache } from './metadata/artwork'
import { CredentialStore } from './metadata/credentials'
import { MetadataManager } from './metadata/manager'
import { MetadataRepo } from './metadata/store'
import { TmdbProvider } from './metadata/tmdb'
import { AutoScanner } from './scan/auto'
import { ScanManager } from './scan/manager'
import { createFfprobeRunner, findFfprobe } from './scan/probe'
import { MediaFileRepo, ScanJobRepo } from './scan/store'
import { TitleRepo } from './scan/titles'
import { ServiceEventRepo, recordCrashIfUncleanShutdown } from './repo/service-events'
import { SettingsRepo } from './repo/settings'
import { loadOrCreateToken } from './security'
import { APP_VERSION } from './version'

export interface RunningServer {
  port: number
  token: string
  logger: Logger
  /** Graceful shutdown: records a clean stop, closes the API and database. */
  stop(reason: string): Promise<void>
}

function writeRuntimeFile(config: ServerConfig, info: RuntimeInfo): void {
  const tmp = `${config.runtimeFile}.tmp`
  writeFileSync(tmp, JSON.stringify(info), 'utf8')
  renameSync(tmp, config.runtimeFile)
}

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  for (const dir of [config.dataDir, config.cacheDir, config.logsDir, config.secretsDir, config.artworkDir]) {
    mkdirSync(dir, { recursive: true })
  }
  const { logger, hub } = createLogger(config)
  const startedAt = new Date()

  const handle = openDatabase(config.databaseFile)
  const serviceEvents = new ServiceEventRepo(handle.db)
  const settings = new SettingsRepo(handle.db)
  const library = new LibrarySourceRepo(handle.db)
  const files = new MediaFileRepo(handle.db, handle.raw)
  const jobs = new ScanJobRepo(handle.db)
  const metadataRepo = new MetadataRepo(handle.raw)
  const titles = new TitleRepo(handle.raw, metadataRepo)
  const collections = new CollectionRepo(handle.raw, titles)
  const playback = new PlaybackRepo(handle.raw, titles)
  const journal = new FileJournal(handle.raw)
  const renamer = new RenameService({ raw: handle.raw, titles, files, journal, logger })
  const reindexed = files.ensureSearchIndex()
  if (reindexed > 0) logger.info({ rows: reindexed }, 'Rebuilt the search index')
  const keyed = files.backfillTitleKeys()
  if (keyed > 0) logger.info({ rows: keyed }, 'Assigned title keys to existing files')
  const events = new EventsHub()

  const ffprobePath = findFfprobe()
  if (ffprobePath) logger.info({ ffprobePath }, 'FFprobe found')
  else logger.warn('FFprobe not found: files are listed without duration, resolution and codecs (run "yarn ffprobe:fetch")')
  const credentials = new CredentialStore(config.tmdbKeyFile)
  const provider = new TmdbProvider({
    credential: () => credentials.get(),
    ...(config.tmdbApiBase ? { apiBase: config.tmdbApiBase } : {}),
    ...(config.tmdbImageBase ? { imageBase: config.tmdbImageBase } : {}),
  })
  const artwork = new ArtworkCache(config.artworkDir, provider.http, (path, size) => provider.imageUrl(path, size))
  const metadata = new MetadataManager({
    provider,
    repo: metadataRepo,
    files,
    collections,
    artwork,
    credentials,
    language: () => settings.get().metadataLanguage,
    emit: (e) => events.broadcast(e),
    resetProvider: () => provider.reset(),
    logger,
  })
  const scans = new ScanManager({
    library,
    files,
    jobs,
    probe: ffprobePath ? createFfprobeRunner({ command: ffprobePath }) : null,
    emit: (e) => {
      events.broadcast(e)
      // New or changed files may be titles we have not looked up yet.
      if (e.type === 'scan.finished') metadata.kick()
    },
    logger,
  })
  const auto = new AutoScanner({ library, manager: scans, logger })
  scans.recoverInterrupted()

  if (recordCrashIfUncleanShutdown(serviceEvents)) {
    logger.warn('Previous run ended without a clean shutdown')
  }
  if (handle.appliedMigrations.length > 0) {
    const reason = `Applied schema migration(s) ${handle.appliedMigrations.join(', ')}`
    serviceEvents.record('migrate', { reason, pid: process.pid, version: APP_VERSION })
    logger.info({ migrations: handle.appliedMigrations }, reason)
  }

  const token = loadOrCreateToken(config.tokenFile)
  const { app } = await buildApp({
    config,
    logger,
    logHub: hub,
    settings,
    serviceEvents,
    library,
    files,
    titles,
    collections,
    playback,
    renamer,
    journal,
    jobs,
    scans,
    auto,
    metadata,
    credentials,
    provider,
    artwork,
    events,
    token,
    startedAt,
    schemaVersion: handle.schemaVersion,
  })

  try {
    await app.listen({ host: '127.0.0.1', port: config.port })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || config.port === 0) throw err
    logger.warn({ port: config.port }, 'Preferred port is busy; picking a free one')
    await app.listen({ host: '127.0.0.1', port: 0 })
  }
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : config.port

  events.startHeartbeat()
  auto.start()
  metadata.start()
  void renamer.recover().catch((err: unknown) => logger.error({ err }, 'Could not settle interrupted renames'))
  writeRuntimeFile(config, {
    port,
    pid: process.pid,
    startedAt: startedAt.toISOString(),
    hostMode: config.hostMode,
    version: APP_VERSION,
  })
  serviceEvents.record('start', {
    reason: `Started in ${config.hostMode} mode on port ${port}`,
    pid: process.pid,
    version: APP_VERSION,
  })
  logger.info({ port, hostMode: config.hostMode, dataDir: config.dataDir }, `Theama server ${APP_VERSION} listening`)
  pruneLogs(config.logsDir, settings.get().logRetentionDays)

  let stopping: Promise<void> | null = null
  const stop = (reason: string): Promise<void> => {
    stopping ??= (async () => {
      logger.info({ reason }, 'Shutting down')
      auto.stop()
      await metadata.stop()
      await scans.close()
      events.stop()
      await app.close()
      serviceEvents.record('stop', { reason, pid: process.pid, version: APP_VERSION })
      rmSync(config.runtimeFile, { force: true })
      handle.close()
    })()
    return stopping
  }
  return { port, token, logger, stop }
}
