import { onBeforeUnmount, onMounted, ref, watch, nextTick, type Ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

/**
 * The root font size in px, as the browser really computes it (viewport clamp x text size x browser preference).
 * Vuetify layout pieces that need a numeric height (app bar, bottom bar, virtual lists) size themselves from this
 * so they follow the text size and are re-read on resize and when the text-size setting changes.
 */
export function useRootFontSize(): Ref<number> {
  const read = (): number => (typeof document === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
  const size = ref(read())
  const settings = useSettingsStore()
  const update = (): void => {
    size.value = read()
  }
  onMounted(() => {
    window.addEventListener('resize', update)
    update()
  })
  onBeforeUnmount(() => window.removeEventListener('resize', update))
  // The scale variable is applied by the settings store; read again once the DOM has it.
  watch(
    () => settings.settings.textSize,
    () => void nextTick(update),
  )
  return size
}
