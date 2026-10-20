import { onBeforeUnmount, type Ref } from 'vue'

/** Largest rotation, in degrees, when the pointer is at the very edge of the card. */
const MAX_TILT = 12

/**
 * Pointer-driven tilt for a poster: sets --tilt-x / --tilt-y / --glare-x / --glare-y on the element,
 * and the stylesheet (under html.th-immersive) turns them into a rotation and a moving highlight.
 * It reads the root class instead of reactive state so a grid of cards costs nothing in Standard mode.
 */
export function useTilt(target: Ref<HTMLElement | null>) {
  let frame = 0
  let pending: PointerEvent | null = null

  function apply(): void {
    frame = 0
    const e = pending
    const el = target.value
    if (!e || !el) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    el.style.setProperty('--tilt-x', `${((0.5 - y) * 2 * MAX_TILT).toFixed(2)}deg`)
    el.style.setProperty('--tilt-y', `${((x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`)
    el.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`)
    el.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`)
  }

  function onPointerMove(e: PointerEvent): void {
    // Mouse and pen only: a touch has no hover to follow. Standard mode does nothing at all.
    if (e.pointerType === 'touch' || !document.documentElement.classList.contains('th-immersive')) return
    pending = e
    if (!frame) frame = requestAnimationFrame(apply)
  }

  function reset(): void {
    pending = null
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    const el = target.value
    if (!el) return
    for (const name of ['--tilt-x', '--tilt-y', '--glare-x', '--glare-y']) el.style.removeProperty(name)
  }

  onBeforeUnmount(reset)
  return { onPointerMove, reset }
}
