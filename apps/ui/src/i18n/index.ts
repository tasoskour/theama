import { createI18n } from 'vue-i18n'
import type { UiLanguage } from '@theama/contracts'
import en from './locales/en.json'
import el from './locales/el.json'

export const SUPPORTED_LANGUAGES: readonly { code: UiLanguage; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'el', label: 'Ελληνικά' },
]

const PREFS_KEY = 'theama.prefs'

export interface CachedPrefs {
  language?: UiLanguage
  theme?: 'system' | 'dark' | 'light'
}

/** Last-known preferences, read before the API answers so first paint is correct. */
export function readCachedPrefs(): CachedPrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as CachedPrefs
  } catch {
    return {}
  }
}

export function writeCachedPrefs(prefs: CachedPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readCachedPrefs(), ...prefs }))
  } catch {
    // Storage may be unavailable; the API remains the source of truth.
  }
}

function initialLanguage(): UiLanguage {
  const cached = readCachedPrefs().language
  if (cached === 'en' || cached === 'el') return cached
  return navigator.language.toLowerCase().startsWith('el') ? 'el' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLanguage(),
  fallbackLocale: 'en',
  messages: { en, el },
  datetimeFormats: {
    en: {
      short: { dateStyle: 'medium', timeStyle: 'short' },
      time: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
      row: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    },
    el: {
      short: { dateStyle: 'medium', timeStyle: 'short' },
      time: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
      row: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    },
  },
})

export function setLanguage(lang: UiLanguage): void {
  i18n.global.locale.value = lang
  document.documentElement.lang = lang
}
