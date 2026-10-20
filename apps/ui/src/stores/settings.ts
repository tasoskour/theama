import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { AppSettings, DEFAULT_SETTINGS, type AppSettingsPatch } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { readCachedPrefs, setLanguage, writeCachedPrefs } from '@/i18n'
import { useConnectionStore } from './connection'

export const useSettingsStore = defineStore('settings', () => {
  const connection = useConnectionStore()
  const cached = readCachedPrefs()
  const settings = ref<AppSettings>({
    ...DEFAULT_SETTINGS,
    language: cached.language ?? DEFAULT_SETTINGS.language,
    theme: cached.theme ?? DEFAULT_SETTINGS.theme,
    visualMode: cached.visualMode ?? DEFAULT_SETTINGS.visualMode,
    graphicsQuality: cached.graphicsQuality ?? DEFAULT_SETTINGS.graphicsQuality,
  })
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  function apply(next: AppSettings): void {
    settings.value = next
    setLanguage(next.language)
    writeCachedPrefs({ language: next.language, theme: next.theme, visualMode: next.visualMode, graphicsQuality: next.graphicsQuality })
    void getBridge()?.setLanguage(next.language)
  }

  async function load(): Promise<void> {
    if (!connection.client) return
    try {
      apply(await connection.client.get('/settings', AppSettings))
      loaded.value = true
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  /** Applies the change locally first so the UI never waits on the network. */
  async function update(patch: AppSettingsPatch): Promise<boolean> {
    const previous = settings.value
    apply({ ...previous, ...patch })
    if (!connection.client) return false
    saving.value = true
    try {
      apply(await connection.client.put('/settings', patch, AppSettings))
      error.value = null
      return true
    } catch (err) {
      apply(previous)
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      saving.value = false
    }
  }

  watch(
    () => connection.phase,
    (phase) => {
      if (phase === 'connected') void load()
    },
    { immediate: true },
  )
  connection.onEvent((e) => {
    if (e.type === 'settings.changed') apply(e.settings)
  })

  return { settings, loaded, saving, error, load, update }
})
