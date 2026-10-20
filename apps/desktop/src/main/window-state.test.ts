import { describe, expect, it } from 'vitest'
import { DEFAULT_SIZE, restoreWindowState } from './window-state'

const screen = { x: 0, y: 0, width: 1920, height: 1080 }
const second = { x: 1920, y: 0, width: 1920, height: 1080 }

describe('restoreWindowState', () => {
  it('reopens where the window was', () => {
    expect(restoreWindowState({ x: 100, y: 80, width: 1200, height: 800, maximized: false }, [screen])).toEqual({ x: 100, y: 80, width: 1200, height: 800, maximized: false })
    expect(restoreWindowState({ x: 2000, y: 40, width: 1000, height: 700, maximized: true }, [screen, second])).toMatchObject({ x: 2000, maximized: true })
  })

  it('keeps the size but lets the system place it when its screen is gone', () => {
    const gone = restoreWindowState({ x: 2100, y: 40, width: 1000, height: 700, maximized: false }, [screen])
    expect(gone).toEqual({ width: 1000, height: 700, maximized: false })
  })

  it('treats a window that is only barely on a screen as off it', () => {
    expect(restoreWindowState({ x: 1900, y: 40, width: 1000, height: 700, maximized: false }, [screen]).x).toBeUndefined()
    expect(restoreWindowState({ x: -900, y: 40, width: 1000, height: 700, maximized: false }, [screen]).x).toBeUndefined()
  })

  it('falls back to the default size for missing, damaged or absurd data', () => {
    for (const bad of [undefined, null, 'x', {}, { width: 5, height: 5 }, { width: 1000, height: 'tall' }, { width: 99_999, height: 500 }]) {
      expect(restoreWindowState(bad, [screen])).toEqual({ ...DEFAULT_SIZE, maximized: false })
    }
  })

  it('never makes the window smaller than it can usefully be', () => {
    expect(restoreWindowState({ width: 300, height: 300, maximized: false }, [screen])).toEqual({ width: 480, height: 560, maximized: false })
  })

  it('remembers size without a position', () => {
    expect(restoreWindowState({ width: 1000, height: 700, maximized: false }, [screen])).toEqual({ width: 1000, height: 700, maximized: false })
  })
})
