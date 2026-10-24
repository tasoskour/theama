import { WebContentsView, session, shell, type BrowserWindow } from 'electron'
import type { TrailerBounds } from '@theama/contracts'
import { externalLinkUrl, isTrailerPageAllowed, TRAILER_REFERRER, trailerEmbedUrl } from './external-link'

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
  private bounds: TrailerBounds | null = null
  private fullscreen = false
  private wasFullScreen = false
  private releaseHost: (() => void) | null = null

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
        // We resize the child view and host together and restore their previous sizes on exit.
        disableHtmlFullscreenWindowResize: true,
      },
    })
    const wc = view.webContents
    const openOnYouTube = (): void => {
      // Build the destination from our validated video id, never from the remote page's URL.
      void shell.openExternal(externalLinkUrl({ service: 'youtube', id })).catch((error: unknown) => {
        console.error('Could not open the trailer on YouTube', error)
      })
    }
    wc.setWindowOpenHandler(({ url }) => {
      // YouTube's "Watch on YouTube" fallback opens a new tab when embedding is disabled.
      if (isTrailerPageAllowed(url)) openOnYouTube()
      return { action: 'deny' }
    })
    const guard = (event: { preventDefault(): void }, target: string): void => {
      if (isTrailerPageAllowed(target) && new URL(target).pathname === '/watch') {
        event.preventDefault()
        openOnYouTube()
        return
      }
      if (!this.deps.testUrl && !isTrailerPageAllowed(target)) event.preventDefault()
    }
    wc.on('will-navigate', (event, target) => guard(event, target))
    wc.on('will-redirect', (event, target) => guard(event, target))
    wc.on('enter-html-full-screen', () => {
      if (this.view !== view) return
      this.wasFullScreen = host.isFullScreen()
      this.fullscreen = true
      host.setFullScreen(true)
      this.applyBounds()
    })
    wc.on('leave-html-full-screen', () => {
      if (this.view !== view) return
      this.fullscreen = false
      if (!this.wasFullScreen) host.setFullScreen(false)
      this.applyBounds()
    })
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        // Let Chromium exit the player's HTML fullscreen before Escape closes the dialog.
        if (this.fullscreen) return
        event.preventDefault()
        this.deps.onEscape()
      }
    })
    view.setBackgroundColor('#000000')
    view.setBounds(bounds)
    host.contentView.addChildView(view)
    this.view = view
    this.host = host
    this.bounds = bounds
    const resize = (): void => this.applyBounds()
    host.on('resize', resize)
    host.on('enter-full-screen', resize)
    host.on('leave-full-screen', resize)
    this.releaseHost = () => {
      host.removeListener('resize', resize)
      host.removeListener('enter-full-screen', resize)
      host.removeListener('leave-full-screen', resize)
    }
    void (this.deps.testUrl ? wc.loadURL(this.deps.testUrl) : wc.loadURL(trailerEmbedUrl(id), { httpReferrer: TRAILER_REFERRER }))
  }

  setBounds(bounds: TrailerBounds): void {
    this.bounds = bounds
    this.applyBounds()
  }

  private applyBounds(): void {
    if (!this.view || !this.host || this.host.isDestroyed() || !this.bounds) return
    if (this.fullscreen) {
      const { width, height } = this.host.getContentBounds()
      this.view.setBounds({ x: 0, y: 0, width, height })
    } else {
      this.view.setBounds(this.bounds)
    }
  }

  /** Removes the view and ends the video. Safe to call when nothing is playing. */
  hide(): void {
    const view = this.view
    if (!view) return
    this.view = null
    this.releaseHost?.()
    this.releaseHost = null
    try {
      if (this.host && !this.host.isDestroyed()) {
        if (this.fullscreen && !this.wasFullScreen) this.host.setFullScreen(false)
        this.host.contentView.removeChildView(view)
      }
    } catch {
      // The window may already be closing.
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
    this.host = null
    this.bounds = null
    this.fullscreen = false
    this.wasFullScreen = false
  }
}
