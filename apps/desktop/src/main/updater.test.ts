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

  it('downloads in the background and installs on quit', () => {
    const { au } = make()
    expect(au.autoDownload).toBe(true)
    expect(au.autoInstallOnAppQuit).toBe(true)
  })

  it('follows a check through to a ready update', async () => {
    const { updater, au, emit, states } = make()
    const done = updater.check()
    emit('checking-for-update')
    emit('update-available', { version: '0.3.0' })
    emit('download-progress', { percent: 41.6 })
    emit('update-downloaded', { version: '0.3.0' })
    await done
    expect(au.checkForUpdates).toHaveBeenCalledOnce()
    expect(states.map((s) => s.status)).toEqual(['checking', 'downloading', 'downloading', 'ready'])
    expect(states[2]).toMatchObject({ percent: 42, version: '0.3.0' })
    expect(updater.state()).toMatchObject({ status: 'ready', version: '0.3.0', percent: 100 })
  })

  it('does not check again while a check, a download or a ready update is pending', async () => {
    const { updater, au, emit } = make()
    void updater.check()
    void updater.check()
    expect(au.checkForUpdates).toHaveBeenCalledOnce()
    await Promise.resolve()
    emit('update-available', { version: '0.3.0' })
    await updater.check()
    expect(au.checkForUpdates).toHaveBeenCalledOnce()
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
