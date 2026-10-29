import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC, type NextUpOffer } from '@theama/contracts'
import { NextEpisodeNotification, nextNotificationHtml, notificationBounds } from './next-episode-notification'

const electron = vi.hoisted(() => {
  const windows: { options: Record<string, unknown>; destroyed: boolean; webContents: { mainFrame: object; send: ReturnType<typeof vi.fn>; setAudioMuted: ReturnType<typeof vi.fn>; setWindowOpenHandler: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }; loadURL: ReturnType<typeof vi.fn>; isDestroyed(): boolean; destroy: ReturnType<typeof vi.fn>; showInactive: ReturnType<typeof vi.fn>; moveTop: ReturnType<typeof vi.fn>; setAlwaysOnTop: ReturnType<typeof vi.fn>; setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }[] = []
  return {
    windows, action: vi.fn(), removeListener: vi.fn(), escape: vi.fn((_key: string, _callback: () => void) => true), unregister: vi.fn(),
    area: { x: -1920, y: 0, width: 1920, height: 1080 },
    BrowserWindow: class {
      destroyed = false
      webContents = { mainFrame: {}, send: vi.fn(), setAudioMuted: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn() }
      loadURL = vi.fn(async () => undefined)
      destroy = vi.fn(() => { this.destroyed = true })
      showInactive = vi.fn()
      moveTop = vi.fn()
      setAlwaysOnTop = vi.fn()
      setVisibleOnAllWorkspaces = vi.fn()
      on = vi.fn()
      constructor(public options: Record<string, unknown>) { windows.push(this) }
      isDestroyed() { return this.destroyed }
    },
  }
})
vi.mock('electron', () => ({
  BrowserWindow: electron.BrowserWindow,
  ipcMain: { on: electron.action, removeListener: electron.removeListener },
  globalShortcut: { register: electron.escape, unregister: electron.unregister },
  screen: { screenToDipRect: (_win: unknown, bounds: unknown) => bounds,
    getDisplayMatching: () => ({ bounds: electron.area, workArea: { ...electron.area, height: 1040 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ bounds: electron.area, workArea: electron.area }),
  },
}))

const offer: NextUpOffer = { offerId: '3e254076-9d20-478c-bd45-0ddf99fe90a1', title: 'Series <script>', countdownSeconds: 5,
  next: { fileId: 2, season: 1, episode: 2, label: 'S01E02', resumeSeconds: null } }
let notification: NextEpisodeNotification
const play = vi.fn(async () => ({ ok: true, code: null, message: null, playerName: 'VLC' }))
const cancel = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  electron.windows.length = 0
  notification = new NextEpisodeNotification({ preload: 'next-notification.cjs', language: () => 'en',
    playerBounds: async () => electron.area, play, cancel })
})
afterEach(() => { notification.dispose(); vi.useRealTimers() })

function act(raw: unknown, source: 'trusted' | 'other-window' | 'subframe' = 'trusted'): void {
  const win = electron.windows.at(-1)!
  const callback = electron.action.mock.calls[0]![1]
  callback({ sender: source === 'other-window' ? {} : win.webContents,
    senderFrame: source === 'subframe' ? {} : win.webContents.mainFrame }, raw)
}

describe('silent next-episode notification', () => {
  it('anchors inside the bottom left of negative-coordinate and small monitors', () => {
    expect(notificationBounds(electron.area)).toEqual({ x: -1908, y: 852, width: 408, height: 216 })
    expect(notificationBounds({ x: 0, y: 0, width: 320, height: 240 })).toEqual({ x: 12, y: 12, width: 296, height: 216 })
  })

  it('stays silent and above fullscreen video without focus or a taskbar entry', async () => {
    await notification.show(offer, 123)
    const win = electron.windows[0]!
    expect(win.options).toMatchObject({ x: -1908, y: 852, focusable: false, skipTaskbar: true, frame: false, transparent: true,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, preload: 'next-notification.cjs' } })
    expect(win.webContents.setAudioMuted).toHaveBeenCalledWith(true)
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(win.showInactive).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.evNextNotification, expect.objectContaining({ offer, remaining: 5 }))
  })

  it('counts down in the main process and accepts an offer only once', async () => {
    await notification.show(offer)
    await vi.advanceTimersByTimeAsync(4000)
    expect(play).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(11000)
    expect(play).toHaveBeenCalledExactlyOnceWith(offer.offerId)
    expect(electron.windows[0]!.destroy).toHaveBeenCalledOnce()
  })

  it('validates the exact notification window, frame and offer before accepting actions', async () => {
    await notification.show(offer)
    act({ offerId: offer.offerId, action: 'play' }, 'other-window')
    act({ offerId: offer.offerId, action: 'play' }, 'subframe')
    act({ offerId: 'forged', action: 'play' })
    expect(play).not.toHaveBeenCalled()
    act({ offerId: offer.offerId, action: 'cancel' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(offer.offerId)
    expect(play).not.toHaveBeenCalled()
  })

  it('dismisses only the matching offer and cancels its timer', async () => {
    await notification.show(offer)
    notification.hide('another-offer')
    expect(electron.windows[0]!.destroy).not.toHaveBeenCalled()
    notification.hide(offer.offerId)
    await vi.advanceTimersByTimeAsync(10000)
    expect(play).not.toHaveBeenCalled()
  })

  it('lets Escape cancel the countdown without focusing the notification and releases the shortcut', async () => {
    await notification.show(offer)
    expect(electron.escape).toHaveBeenCalledWith('Escape', expect.any(Function))
    electron.escape.mock.calls[0]![1]()
    await vi.advanceTimersByTimeAsync(10000)
    expect(cancel).toHaveBeenCalledWith(offer.offerId)
    expect(play).not.toHaveBeenCalled()
    expect(electron.unregister).toHaveBeenCalledWith('Escape')
  })

  it('keeps untrusted titles out of HTML and blocks network or media sources', () => {
    const html = nextNotificationHtml()
    expect(html).not.toContain(offer.title)
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('.textContent=')
    expect(html).not.toMatch(/<(audio|video)\b/)
  })
})
