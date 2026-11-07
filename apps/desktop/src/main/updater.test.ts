import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@theama/contracts'
import { Updater, type AutoUpdaterLike } from './updater'

function fakeAutoUpdater() {
  const handlers = new Map<string, (arg?: never) => void>()
  const au = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn((event: string, listener: (arg?: never) => void) => { handlers.set(event, listener); return au }),
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  }
  const emit = (event: string, arg?: unknown): void => handlers.get(event)?.(arg as never)
  return { au: au as unknown as AutoUpdaterLike & typeof au, emit }
}

function make(enabled = true) {
  const { au, emit } = fakeAutoUpdater()
  const states: UpdateState[] = []
  const log = vi.fn()
  const updater = new Updater({ enabled, autoUpdater: au, onChange: (s) => states.push(s), log })
  return { updater, au, emit, states, log }
}

describe('Updater', () => {
  it('stays disabled and contacts nothing when updates are off', async () => {
    const { updater, au } = make(false)
    expect(updater.state().status).toBe('disabled')
    await updater.check()
    updater.install()
    expect(au.checkForUpdates).not.toHaveBeenCalled()
    expect(au.quitAndInstall).not.toHaveBeenCalled()
  })

  it('asks first: nothing is downloaded or installed on quit until the person chooses', () => {
    const { au } = make()
    expect(au.autoDownload).toBe(false)
    expect(au.autoInstallOnAppQuit).toBe(false)
  })

  it('stops at "available" when a version is found, without downloading it', async () => {
    const { updater, au, emit, states } = make()
    const done = updater.check()
    emit('checking-for-update')
    emit('update-available', { version: '0.3.0' })
    await done
    expect(states.map((s) => s.status)).toEqual(['checking', 'available'])
    expect(updater.state()).toMatchObject({ status: 'available', version: '0.3.0', percent: null, installWhenReady: false })
    expect(au.downloadUpdate).not.toHaveBeenCalled()
  })

  it('"update when closed" downloads, keeps running, and installs on quit', () => {
    const { updater, au, emit } = make()
    emit('update-available', { version: '0.3.0' })
    updater.download('quit')
    expect(au.downloadUpdate).toHaveBeenCalledOnce()
    expect(au.autoInstallOnAppQuit).toBe(true)
    emit('download-progress', { percent: 41.6 })
    expect(updater.state()).toMatchObject({ status: 'downloading', percent: 42, installWhenReady: false })
    emit('update-downloaded', { version: '0.3.0' })
    expect(updater.state()).toMatchObject({ status: 'ready', version: '0.3.0', percent: 100 })
    expect(au.quitAndInstall).not.toHaveBeenCalled()
  })

  it('"update now" downloads and restarts into the new version once it is downloaded', () => {
    const { updater, au, emit } = make()
    emit('update-available', { version: '0.3.0' })
    updater.download('now')
    expect(au.downloadUpdate).toHaveBeenCalledOnce()
    expect(au.autoInstallOnAppQuit).toBe(false)
    expect(updater.state()).toMatchObject({ status: 'downloading', installWhenReady: true })
    expect(au.quitAndInstall).not.toHaveBeenCalled()
    emit('update-downloaded', { version: '0.3.0' })
    expect(au.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('skipping returns to idle without downloading, and a later check offers it again', async () => {
    const { updater, au, emit } = make()
    emit('update-available', { version: '0.3.0' })
    updater.skip()
    expect(updater.state()).toMatchObject({ status: 'idle', version: null })
    expect(au.downloadUpdate).not.toHaveBeenCalled()
    expect(au.autoInstallOnAppQuit).toBe(false)
    await updater.check()
    expect(au.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('ignores download and skip unless a version is waiting for a decision', () => {
    const { updater, au } = make()
    updater.download('now')
    updater.skip()
    expect(au.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.state().status).toBe('idle')
  })

  it('does not check again while a check, a decision, a download or a ready update is pending', async () => {
    const { updater, au, emit } = make()
    void updater.check()
    void updater.check()
    expect(au.checkForUpdates).toHaveBeenCalledOnce()
    await Promise.resolve()
    emit('update-available', { version: '0.3.0' })
    await updater.check()
    expect(au.checkForUpdates).toHaveBeenCalledOnce()
    updater.download('quit')
    await updater.check()
    expect(au.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('checks once shortly after start-up and not again', () => {
    vi.useFakeTimers()
    try {
      const { updater, au } = make()
      updater.start()
      expect(au.checkForUpdates).not.toHaveBeenCalled()
      vi.advanceTimersByTime(5_000)
      expect(au.checkForUpdates).toHaveBeenCalledOnce()
      vi.advanceTimersByTime(24 * 60 * 60 * 1000)
      expect(au.checkForUpdates).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('goes to an error, not a restart, when the download fails', () => {
    const { updater, au, emit } = make()
    emit('update-available', { version: '0.3.0' })
    updater.download('now')
    emit('error', new Error('net::ERR_CONNECTION_RESET'))
    expect(updater.state()).toMatchObject({ status: 'error', installWhenReady: false })
    expect(au.quitAndInstall).not.toHaveBeenCalled()
  })

  it('reports a failed check as an error with a short message, and can check again', async () => {
    const { updater, au, emit, log } = make()
    await updater.check()
    emit('error', new Error('net::ERR_INTERNET_DISCONNECTED\nlong stack'))
    expect(updater.state()).toMatchObject({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' })
    expect(log).toHaveBeenCalledWith('warn', expect.any(String), expect.anything())
    await updater.check()
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('survives a rejected check without an unhandled rejection', async () => {
    const { updater, au } = make()
    au.checkForUpdates.mockRejectedValueOnce(new Error('boom'))
    await expect(updater.check()).resolves.toBeDefined()
  })

  it('installs only once an update is ready', () => {
    const { updater, au, emit } = make()
    updater.install()
    expect(au.quitAndInstall).not.toHaveBeenCalled()
    emit('update-downloaded', { version: '0.3.0' })
    updater.install()
    expect(au.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
