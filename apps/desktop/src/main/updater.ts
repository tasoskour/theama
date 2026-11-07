import type { UpdateChoice, UpdateState } from '@theama/contracts'

/** The part of electron-updater's `autoUpdater` that Theama uses, so tests can stand in for it. */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterOptions {
  /** False in a development build or a test run: nothing is contacted and the state stays `disabled`. */
  enabled: boolean
  autoUpdater: AutoUpdaterLike
  onChange(state: UpdateState): void
  log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void
  /** Wait before the automatic check at start-up, so the window is up and listening. */
  firstCheckDelayMs?: number
}

const FIRST_CHECK_MS = 5_000

/**
 * Keeps Theama up to date from its release feed (GitHub Releases, configured in electron-builder.yml).
 * It looks once when Theama starts. A version that is found is only downloaded after the person chooses:
 * install now (restart as soon as it is downloaded), install when Theama is next closed, or skip it.
 */
export class Updater {
  private current: UpdateState
  private timers: NodeJS.Timeout[] = []
  private checking: Promise<UpdateState> | null = null

  constructor(private readonly opts: UpdaterOptions) {
    this.current = { status: opts.enabled ? 'idle' : 'disabled', version: null, percent: null, message: null, installWhenReady: false }
    if (!opts.enabled) return
    const au = opts.autoUpdater
    au.autoDownload = false
    au.autoInstallOnAppQuit = false
    au.on('checking-for-update', () => this.set({ status: 'checking', message: null }))
    au.on('update-available', (info) => this.set({ status: 'available', version: info.version, percent: null, message: null, installWhenReady: false }))
    au.on('update-not-available', () => this.set({ status: 'up-to-date', version: null, percent: null, message: null }))
    au.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent))) }))
    au.on('update-downloaded', (info) => {
      opts.log('info', 'An update was downloaded', { version: info.version })
      this.set({ status: 'ready', version: info.version, percent: 100, message: null })
      if (this.current.installWhenReady) this.install()
    })
    au.on('error', (error) => {
      opts.log('warn', 'The update check failed', { message: error.message })
      this.set({ status: 'error', percent: null, message: error.message.split('\n')[0]?.slice(0, 300) ?? 'Update failed', installWhenReady: false })
    })
  }

  state(): UpdateState {
    return this.current
  }

  /** Looks for a new version once, shortly after start-up. */
  start(): void {
    if (!this.opts.enabled) return
    const first = setTimeout(() => void this.check(), this.opts.firstCheckDelayMs ?? FIRST_CHECK_MS)
    first.unref()
    this.timers.push(first)
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  /** Looks for a newer version now. Does nothing while one is waiting for a decision, downloading or ready to install. */
  check(): Promise<UpdateState> {
    const { status } = this.current
    if (!this.opts.enabled || status === 'available' || status === 'downloading' || status === 'ready') return Promise.resolve(this.current)
    this.checking ??= this.opts.autoUpdater.checkForUpdates()
      .then(() => this.current)
      // The failure itself arrives through the 'error' event; this only keeps the rejection from being unhandled.
      .catch(() => this.current)
      .finally(() => { this.checking = null })
    return this.checking
  }

  /**
   * Downloads the version that was found. `now` restarts into it as soon as it is downloaded;
   * `quit` leaves Theama running and installs it when Theama is next closed.
   */
  download(when: UpdateChoice['when']): void {
    if (this.current.status !== 'available') return
    this.opts.log('info', 'Downloading the update', { version: this.current.version, when })
    this.opts.autoUpdater.autoInstallOnAppQuit = when === 'quit'
    this.set({ status: 'downloading', percent: 0, installWhenReady: when === 'now' })
    // A failure arrives through the 'error' event; this only keeps the rejection from being unhandled.
    this.opts.autoUpdater.downloadUpdate().catch(() => undefined)
  }

  /** Dismisses the version that was found. It is offered again on the next launch or a manual check. */
  skip(): void {
    if (this.current.status !== 'available') return
    this.opts.log('info', 'The update was skipped', { version: this.current.version })
    this.set({ status: 'idle', version: null, percent: null, installWhenReady: false })
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
