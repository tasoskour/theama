/** Decisions about when the window leaves or comes back, kept free of Electron so they can be tested. */

export interface BehaviourState {
  /** The person chose to keep Theama in the notification area when the window is closed. */
  closeToTray: boolean
  /** The tray icon actually exists (without it a hidden window could never be brought back). */
  trayShown: boolean
  /** The app is on its way out (Quit, an installer, Windows shutting down). */
  quitting: boolean
}

/** Closing the window hides it instead only when there is a tray icon to get it back from. */
export function shouldHideOnClose(s: BehaviourState): boolean {
  return s.closeToTray && s.trayShown && !s.quitting
}

/** Windows starts Theama at sign-in with `--hidden`; it then stays in the tray instead of opening a window. */
export function shouldStartHidden(argv: readonly string[], closeToTray: boolean, trayShown: boolean): boolean {
  return argv.includes('--hidden') && closeToTray && trayShown
}
