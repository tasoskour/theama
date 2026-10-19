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

/**
 * App-wide keyboard shortcuts:
 *   /  or  Ctrl+F    open search
 *   Alt+Left         back
 *   Backspace        back (outside text fields)
 *   Escape           back (when nothing is open and no field is focused)
 */
export function useGlobalShortcuts(): void {
  const router = useRouter()

  function onKeydown(e: KeyboardEvent): void {
    const editable = isEditable(e.target)
    if ((e.key === '/' && !editable && !e.ctrlKey && !e.metaKey) || (e.key.toLowerCase() === 'f' && e.ctrlKey)) {
      e.preventDefault()
      void router.push('/search')
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
