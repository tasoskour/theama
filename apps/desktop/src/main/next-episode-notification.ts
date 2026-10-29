import { BrowserWindow, globalShortcut, ipcMain, screen, type Rectangle } from 'electron'
import { randomBytes } from 'node:crypto'
import { IPC, NextNotificationAction, type NextNotificationState, type NextUpOffer, type PlayResult, type UiLanguage } from '@theama/contracts'

export const NEXT_NOTIFICATION_URL = 'app://theama/next-episode-notification'

/** Static document: user titles and errors enter only through textContent over a narrow preload. */
export function nextNotificationHtml(): string {
  const nonce = randomBytes(16).toString('base64')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'">
<title>Theama · Next episode</title><style>
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:#efe8da;font:14px 'Segoe UI',sans-serif}
body{height:100vh;display:flex;align-items:flex-end}.notice{flex:1;min-width:0}
.notice{margin:8px;padding:14px 16px 12px;border:1px solid #bea77865;border-radius:14px;background:rgba(20,19,17,.98);box-shadow:0 4px 20px #0008}
.kicker{color:#c6b082;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase}
h1{margin:5px 0;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
p{margin:0 0 10px;color:#c8c0b2;font-size:12px;line-height:1.4;min-height:18px}
.bar{height:3px;background:#ffffff15;border-radius:2px;overflow:hidden}.fill{height:100%;background:#c6b082;transition:width .2s linear}
.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:10px}
button{border:0;border-radius:6px;padding:6px 13px;font:600 12px 'Segoe UI',sans-serif;cursor:pointer}
#cancel{color:#efe8da;background:#ffffff0b}#play{color:#191711;background:#c6b082}button:hover{filter:brightness(1.15)}button:disabled{opacity:.55;cursor:default}
.error{color:#f0b7aa;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
</style></head><body><section class="notice" role="status" aria-live="polite" data-test="next-up-notification">
<div class="kicker" id="kicker"></div><h1 id="title"></h1><p id="count" data-test="next-up-count"></p>
<div class="bar" aria-hidden="true"><div class="fill" id="fill"></div></div><div class="actions">
<button id="cancel" data-test="next-up-cancel"></button><button id="play" data-test="next-up-play"></button></div></section>
<script nonce="${nonce}">
let current;
const element=id=>document.getElementById(id);
window.nextEpisodeNotice.onUpdate(state=>{
  current=state;const greek=state.language==='el';document.documentElement.lang=greek?'el':'en';
  element('kicker').textContent=greek?'Theama · Επόμενο επεισόδιο':'Theama · Up next';
  element('title').textContent=state.offer.title+' · '+state.offer.next.label;
  element('count').textContent=state.error||(state.busy?(greek?'Ξεκινά το επόμενο επεισόδιο…':'Starting the next episode…'):
    (greek?'Το επόμενο επεισόδιο ξεκινά σε '+state.remaining+' δευτ.':'The next episode starts in '+state.remaining+' seconds.'));
  element('count').className=state.error?'error':'';
  element('cancel').textContent=state.error?(greek?'Κλείσιμο':'Dismiss'):(greek?'Ακύρωση':'Cancel');
  element('cancel').disabled=state.busy;
  element('play').textContent=greek?'Αναπαραγωγή τώρα':'Play now';element('play').disabled=state.busy||!!state.error;
  element('fill').style.width=(state.offer.countdownSeconds?Math.max(0,state.remaining/state.offer.countdownSeconds*100):0)+'%';
});
element('cancel').onclick=()=>{if(current)window.nextEpisodeNotice.act('cancel',current.offer.offerId)};
element('play').onclick=()=>{if(current)window.nextEpisodeNotice.act('play',current.offer.offerId)};
</script></body></html>`
}

export function notificationBounds(area: Rectangle): Rectangle {
  const width = Math.min(408, area.width - 24)
  const height = Math.min(216, area.height - 24)
  return { x: area.x + 12, y: area.y + area.height - height - 12, width, height }
}

interface NotificationDeps {
  preload: string
  language(): UiLanguage
  playerBounds(pid: number): Promise<Rectangle | null>
  play(offerId: string): Promise<PlayResult>
  cancel(offerId: string): void
}

/** Silent, non-activating desktop notification above composited fullscreen video. The main process owns the timer. */
export class NextEpisodeNotification {
  private window: BrowserWindow | null = null
  private state: NextNotificationState | null = null
  private timer?: ReturnType<typeof setInterval>
  private dismissTimer?: ReturnType<typeof setTimeout>
  private escapeRegistered = false
  private readonly action = (event: Electron.IpcMainEvent, raw: unknown): void => {
    const win = this.window
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return
    const parsed = NextNotificationAction.safeParse(raw)
    if (!parsed.success || parsed.data.offerId !== this.state?.offer.offerId || this.state.busy) return
    if (parsed.data.action === 'play' && !this.state.error) void this.play()
    else if (parsed.data.action === 'play') return
    else {
      const id = parsed.data.offerId
      this.hide()
      this.deps.cancel(id)
    }
  }

  constructor(private readonly deps: NotificationDeps) {
    ipcMain.on(IPC.nextNotificationAction, this.action)
  }

  async show(offer: NextUpOffer, playerPid?: number): Promise<void> {
    this.hide()
    this.state = { offer, remaining: offer.countdownSeconds, language: this.deps.language(), busy: false, error: null }
    const physical = playerPid ? await this.deps.playerBounds(playerPid).catch(() => null) : null
    if (this.state?.offer.offerId !== offer.offerId) return
    const player = physical ? screen.screenToDipRect(null, physical) : null
    const display = player ? screen.getDisplayMatching(player) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const fullscreen = player && player.width >= display.bounds.width - 16 && player.height >= display.bounds.height - 16
    const win = new BrowserWindow({
      ...notificationBounds(fullscreen ? display.bounds : display.workArea), show: false, frame: false, transparent: true,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, hasShadow: false, backgroundColor: '#00000000',
      title: 'Theama · Next episode',
      webPreferences: { preload: this.deps.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
    })
    this.window = win
    const lost = (): void => {
      if (this.window !== win) return
      const id = this.state?.offer.offerId
      this.hide()
      if (id) this.deps.cancel(id)
    }
    win.on('closed', lost)
    win.webContents.on('render-process-gone', lost)
    win.webContents.setAudioMuted(true)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    await win.loadURL(NEXT_NOTIFICATION_URL)
    if (this.window !== win || win.isDestroyed()) return
    this.update()
    win.showInactive()
    win.moveTop()
    this.escapeRegistered = globalShortcut.register('Escape', () => {
      const id = this.state?.offer.offerId
      this.hide()
      if (id) this.deps.cancel(id)
    })
    const deadline = Date.now() + offer.countdownSeconds * 1000
    if (offer.countdownSeconds === 0) { void this.play(); return }
    this.timer = setInterval(() => {
      if (!this.state) return
      this.state.remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      this.update()
      if (this.state.remaining === 0) void this.play()
    }, 250)
  }

  private update(): void {
    if (this.window && !this.window.isDestroyed() && this.state) this.window.webContents.send(IPC.evNextNotification, this.state)
  }

  private async play(): Promise<void> {
    const state = this.state
    if (!state || state.busy) return
    clearInterval(this.timer)
    this.releaseEscape()
    state.busy = true
    this.update()
    const result = await this.deps.play(state.offer.offerId).catch((error: unknown): PlayResult => ({
      ok: false, code: 'launch_failed', message: error instanceof Error ? error.message : String(error), playerName: null,
    }))
    if (this.state !== state) return
    if (result.ok) this.hide()
    else {
      state.busy = false
      state.error = result.message ?? 'The next episode could not be started'
      this.update()
      this.dismissTimer = setTimeout(() => this.hide(), 6000)
    }
  }

  hide(offerId?: string): void {
    if (offerId && this.state?.offer.offerId !== offerId) return
    clearInterval(this.timer)
    clearTimeout(this.dismissTimer)
    this.releaseEscape()
    this.state = null
    const win = this.window
    this.window = null
    if (win && !win.isDestroyed()) win.destroy()
  }

  private releaseEscape(): void {
    if (this.escapeRegistered) globalShortcut.unregister('Escape')
    this.escapeRegistered = false
  }

  dispose(): void {
    this.hide()
    ipcMain.removeListener(IPC.nextNotificationAction, this.action)
  }
}
