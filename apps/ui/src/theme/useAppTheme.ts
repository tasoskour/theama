import { watchEffect, onScopeDispose, ref } from 'vue'
import { useTheme } from 'vuetify'
import type { ThemePreference } from '@theama/contracts'
import { THEME_DARK, THEME_LIGHT } from './vuetify'

/** Applies a theme preference ('system' follows the OS and reacts to changes). */
export function useAppTheme(preference: () => ThemePreference): void {
  const theme = useTheme()
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = ref(query.matches)
  const onChange = (e: MediaQueryListEvent) => (systemDark.value = e.matches)
  query.addEventListener('change', onChange)
  onScopeDispose(() => query.removeEventListener('change', onChange))

  watchEffect(() => {
    const pref = preference()
    const dark = pref === 'system' ? systemDark.value : pref === 'dark'
    theme.change(dark ? THEME_DARK : THEME_LIGHT)
  })
}
