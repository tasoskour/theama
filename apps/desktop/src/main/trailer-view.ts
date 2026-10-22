import { WebContentsView, session, type BrowserWindow } from 'electron'
import type { TrailerBounds } from '@theama/contracts'
import { isTrailerPageAllowed, TRAILER_REFERRER, trailerEmbedUrl } from './external-link'

/** One partition for every trailer: in memory only, so nothing YouTube sets (cookies, history) is kept. */
export const TRAILER_PARTITION = 'theama-trailer'

export interface TrailerDeps {
  /** Development/test only: load this page instead of YouTube. */
  testUrl?: string
  /** The person pressed Escape inside the video: the page should close its trailer container too. */
  onEscape(): void
}

/**
 * The trailer plays in a view laid over the app window, exactly on the video area of Theama's own trailer
 * container (the page measures it and tells us where). The view has no access to Theama (no preload,
 * sandboxed, its own in-memory session), can only stay on YouTube, and is thrown away when the container closes.
 */
export class TrailerView {
  private view: WebContentsView | null = null
  private host: BrowserWindow | null = null

  constructor(private readonly deps: TrailerDeps) {}

  show(host: BrowserWindow, id: string, bounds: TrailerBounds): void {
    this.hide()
    const ses = session.fromPartition(TRAILER_PARTITION)
    // Only fullscreen is ever granted (the player's own button); camera, microphone, notifications and the rest are not.
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'))

    const view = new WebContentsView({
      webPreferences: {
        partition: TRAILER_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    const wc = view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    const guard = (event: { preventDefault(): void }, target: string): void => {
      if (!this.deps.testUrl && !isTrailerPageAllowed(target)) event.preventDefault()
    }
    wc.on('will-navigate', (event, target) => guard(event, target))
    wc.on('will-redirect', (event, target) => guard(event, target))
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        this.deps.onEscape()
      }
    })
    view.setBackgroundColor('#000000')
    view.setBounds(bounds)
    host.contentView.addChildView(view)
    this.view = view
    this.host = host
    void (this.deps.testUrl ? wc.loadURL(this.deps.testUrl) : wc.loadURL(trailerEmbedUrl(id), { httpReferrer: TRAILER_REFERRER }))
  }

  setBounds(bounds: TrailerBounds): void {
    this.view?.setBounds(bounds)
  }

  /** Removes the view and ends the video. Safe to call when nothing is playing. */
  hide(): void {
    const view = this.view
    if (!view) return
    this.view = null
    try {
      if (this.host && !this.host.isDestroyed()) this.host.contentView.removeChildView(view)
    } catch {
      // The window may already be closing.
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
    this.host = null
  }
}
