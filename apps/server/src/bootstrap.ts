import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { Logger } from 'pino'
import type { RuntimeInfo } from '@theama/contracts'
import { pruneLogs } from '@theama/logs'
import { buildApp } from './app'
import type { ServerConfig } from './config'
import { openDatabase } from './db/client'
import { createLogger } from './log/logger'
import { LibrarySourceRepo } from './library/sources'
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
  for (const dir of [config.dataDir, config.cacheDir, config.logsDir, config.secretsDir]) {
    mkdirSync(dir, { recursive: true })
  }
  const { logger, hub } = createLogger(config)
  const startedAt = new Date()

  const handle = openDatabase(config.databaseFile)
  const serviceEvents = new ServiceEventRepo(handle.db)
  const settings = new SettingsRepo(handle.db)
  const library = new LibrarySourceRepo(handle.db)

  if (recordCrashIfUncleanShutdown(serviceEvents)) {
    logger.warn('Previous run ended without a clean shutdown')
  }
  if (handle.appliedMigrations.length > 0) {
    const reason = `Applied schema migration(s) ${handle.appliedMigrations.join(', ')}`
    serviceEvents.record('migrate', { reason, pid: process.pid, version: APP_VERSION })
    logger.info({ migrations: handle.appliedMigrations }, reason)
  }

  const token = loadOrCreateToken(config.tokenFile)
  const { app, events } = await buildApp({
    config,
    logger,
    logHub: hub,
    settings,
    serviceEvents,
    library,
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
