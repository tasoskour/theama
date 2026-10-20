import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** An open dialog, menu or overlay owns Escape/Backspace; page-level handlers stand down. */
function overlayOpen(): boolean {
  return document.querySelector('.v-overlay--active') !== null
}

const ROUTE_SHORTCUTS: Readonly<Record<string, string>> = {
  Digit1: '/',
  Digit2: '/movies',
  Digit3: '/series',
  Digit4: '/videos',
  Digit5: '/collections',
  Comma: '/settings',
  KeyF: '/search',
}

/**
 * App-wide keyboard shortcuts:
 *   /  or  Ctrl+F    open search
 *   Ctrl+1…5         open Home, Movies, Series, My Videos or Collections
 *   Ctrl+,           open Settings
 *   Ctrl+Shift+L     open log history
 *   Alt+Left         back
 *   Backspace        back (outside text fields)
 *   Escape           back (when nothing is open and no field is focused)
 */
export function useGlobalShortcuts(): void {
  const router = useRouter()

  function onKeydown(e: KeyboardEvent): void {
    const editable = isEditable(e.target)
    const command = e.ctrlKey || e.metaKey
    const route = command && !e.altKey && !e.shiftKey
      ? ROUTE_SHORTCUTS[e.code]
      : command && !e.altKey && e.shiftKey && e.code === 'KeyL'
        ? '/settings/advanced/logs'
        : null
    if (route || (e.key === '/' && !editable && !command)) {
      e.preventDefault()
      void router.push(route ?? '/search')
      return
    }
    if (e.key === 'ArrowLeft' && e.altKey) {
      e.preventDefault()
      router.back()
      return
    }
    if ((e.key === 'Backspace' || e.key === 'Escape') && !editable && !overlayOpen() && !e.altKey && !e.ctrlKey) {
      if (window.history.state?.back) router.back()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onUnmounted(() => window.removeEventListener('keydown', onKeydown))
}
