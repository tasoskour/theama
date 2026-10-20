import { describe, expect, it } from 'vitest'
import { shouldHideOnClose, shouldStartHidden } from './behaviour'

describe('shouldHideOnClose', () => {
  it('hides the window only when the person wants the tray, the tray exists and the app is not quitting', () => {
    expect(shouldHideOnClose({ closeToTray: true, trayShown: true, quitting: false })).toBe(true)
    expect(shouldHideOnClose({ closeToTray: false, trayShown: true, quitting: false })).toBe(false)
    expect(shouldHideOnClose({ closeToTray: true, trayShown: false, quitting: false })).toBe(false) // nothing to bring it back from
    expect(shouldHideOnClose({ closeToTray: true, trayShown: true, quitting: true })).toBe(false) // Quit really quits
  })
})

describe('shouldStartHidden', () => {
  it('starts hidden only for the sign-in launch, and only with a tray to show it from', () => {
    expect(shouldStartHidden(['Theama.exe', '--hidden'], true, true)).toBe(true)
    expect(shouldStartHidden(['Theama.exe'], true, true)).toBe(false) // opened by hand: show the window
    expect(shouldStartHidden(['Theama.exe', '--hidden'], false, true)).toBe(false)
    expect(shouldStartHidden(['Theama.exe', '--hidden'], true, false)).toBe(false)
  })
})
