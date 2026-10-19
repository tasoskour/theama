import { startServer } from './bootstrap'
import { loadConfig } from './config'

async function main(): Promise<void> {
  const config = loadConfig()
  const server = await startServer(config)
  const { logger } = server

  let exiting = false
  const shutdown = (reason: string, code = 0): void => {
    if (exiting) return
    exiting = true
    server
      .stop(reason)
      .catch((err: unknown) => logger.error({ err }, 'Error during shutdown'))
      .finally(() => process.exit(code))
  }

  // NSSM stops a console app with Ctrl+C (SIGINT), then WM_CLOSE, then terminates it.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.on(signal, () => shutdown(`Received ${signal}`))
  }

  // The desktop shell's dev controller runs the server as a child with piped
  // stdin because TerminateProcess would skip the graceful stop above.
  if (process.env.THEAMA_STDIN_CONTROL === '1') {
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk: string) => {
      if (chunk.includes('shutdown')) shutdown('Stopped by the desktop shell')
    })
    process.stdin.on('end', () => shutdown('Parent process closed the control pipe'))
  }

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception')
    process.exitCode = 1
    shutdown('Uncaught exception', 1)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection')
  })
}

main().catch((err: unknown) => {
  // The logger may not exist yet; stderr is captured by NSSM in service mode.
  console.error('Theama server failed to start:', err)
  process.exit(1)
})
