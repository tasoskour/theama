import type { UpdateState } from '@theama/contracts'

/** The part of electron-updater's `autoUpdater` that Theama uses, so tests can stand in for it. */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterOptions {
  /** False in a development build or a test run: nothing is contacted and the state stays `disabled`. */
  enabled: boolean
  autoUpdater: AutoUpdaterLike
  onChange(state: UpdateState): void
  log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void
  /** Wait before the first automatic check, so start-up is not slowed down. */
  firstCheckDelayMs?: number
  /** Time between automatic checks. */
  intervalMs?: number
}

const FIRST_CHECK_MS = 30_000
const INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Keeps Theama up to date from its release feed (GitHub Releases, configured in electron-builder.yml).
 * New versions are downloaded in the background and installed when the app next quits, or at once on request.
 */
export class Updater {
  private current: UpdateState
  private timers: NodeJS.Timeout[] = []
  private checking: Promise<UpdateState> | null = null

  constructor(private readonly opts: UpdaterOptions) {
    this.current = { status: opts.enabled ? 'idle' : 'disabled', version: null, percent: null, message: null }
    if (!opts.enabled) return
    const au = opts.autoUpdater
    au.autoDownload = true
    au.autoInstallOnAppQuit = true
    au.on('checking-for-update', () => this.set({ status: 'checking', message: null }))
    au.on('update-available', (info) => this.set({ status: 'downloading', version: info.version, percent: 0, message: null }))
    au.on('update-not-available', () => this.set({ status: 'up-to-date', version: null, percent: null, message: null }))
    au.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent))) }))
    au.on('update-downloaded', (info) => {
      opts.log('info', 'An update was downloaded', { version: info.version })
      this.set({ status: 'ready', version: info.version, percent: 100, message: null })
    })
    au.on('error', (error) => {
      opts.log('warn', 'The update check failed', { message: error.message })
      this.set({ status: 'error', percent: null, message: error.message.split('\n')[0]?.slice(0, 300) ?? 'Update failed' })
    })
  }

  state(): UpdateState {
    return this.current
  }

  /** Starts the periodic checks. */
  start(): void {
    if (!this.opts.enabled) return
    const first = setTimeout(() => void this.check(), this.opts.firstCheckDelayMs ?? FIRST_CHECK_MS)
    const every = setInterval(() => void this.check(), this.opts.intervalMs ?? INTERVAL_MS)
    first.unref()
    every.unref()
    this.timers.push(first, every)
  }

  stop(): void {
    for (const t of this.timers) { clearTimeout(t); clearInterval(t) }
    this.timers = []
  }

  /** Looks for a newer version now. Does nothing while one is already downloading or ready to install. */
  check(): Promise<UpdateState> {
    if (!this.opts.enabled || this.current.status === 'downloading' || this.current.status === 'ready') return Promise.resolve(this.current)
    this.checking ??= this.opts.autoUpdater.checkForUpdates()
      .then(() => this.current)
      // The failure itself arrives through the 'error' event; this only keeps the rejection from being unhandled.
      .catch(() => this.current)
      .finally(() => { this.checking = null })
    return this.checking
  }

  /** Quits Theama and runs the downloaded installer. The installer restarts the service and the app. */
  install(): void {
    if (this.current.status !== 'ready') return
    this.opts.log('info', 'Installing the downloaded update', { version: this.current.version })
    this.stop()
    this.opts.autoUpdater.quitAndInstall(false, true)
  }

  private set(patch: Partial<UpdateState>): void {
    this.current = { ...this.current, ...patch }
    this.opts.onChange(this.current)
  }
}
