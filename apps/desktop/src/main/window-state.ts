import { z } from 'zod'

export const WindowState = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(200).max(20_000),
  height: z.number().int().min(200).max(20_000),
  maximized: z.boolean().default(false),
})
export type WindowState = z.infer<typeof WindowState>

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_SIZE = { width: 1360, height: 860 }
export const MIN_SIZE = { width: 480, height: 560 }

/** How much of the window must be on a screen for the saved position to be used: enough to grab and drag it back. */
const VISIBLE_MARGIN = 120

const overlap = (a: Rect, b: Rect): { w: number; h: number } => ({
  w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
})

/**
 * What to open the window with: the size and place it had last time, unless that place is no longer on any
 * screen (a monitor was unplugged, the resolution changed), in which case the size is kept and the system
 * picks the position. Anything unreadable gives the default size.
 */
export function restoreWindowState(saved: unknown, displays: readonly Rect[]): WindowState {
  const parsed = WindowState.safeParse(saved)
  if (!parsed.success) return { ...DEFAULT_SIZE, maximized: false }
  const s = parsed.data
  const width = Math.max(MIN_SIZE.width, s.width)
  const height = Math.max(MIN_SIZE.height, s.height)
  if (s.x === undefined || s.y === undefined) return { width, height, maximized: s.maximized }
  const frame: Rect = { x: s.x, y: s.y, width, height }
  const onScreen = displays.some((d) => {
    const o = overlap(frame, d)
    return o.w >= Math.min(VISIBLE_MARGIN, width) && o.h >= Math.min(VISIBLE_MARGIN, height)
  })
  return onScreen ? { x: s.x, y: s.y, width, height, maximized: s.maximized } : { width, height, maximized: s.maximized }
}
