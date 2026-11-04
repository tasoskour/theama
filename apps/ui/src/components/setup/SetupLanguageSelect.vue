<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { UiLanguage } from '@theama/contracts'
import { SUPPORTED_LANGUAGES, setLanguage, writeCachedPrefs } from '@/i18n'
import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'

const { locale } = useI18n()
const connection = useConnectionStore()
const settings = useSettingsStore()
const items = SUPPORTED_LANGUAGES.map((l) => ({ title: l.label, value: l.code }))

async function choose(value: string): Promise<void> {
  const language: UiLanguage = value === 'el' ? 'el' : 'en'
  setLanguage(language)
  writeCachedPrefs({ language })
  // Without a backend the choice is remembered on this computer and saved once it connects.
  if (connection.isConnected) await settings.update({ language })
}
</script>

<template>
  <v-select
    class="language-select"
    :model-value="locale"
    :items="items"
    :label="$t('settings.general.language')"
    density="compact"
    hide-details
    :disabled="settings.saving"
    data-test="setup-language"
    @update:model-value="choose"
  />
</template>

<style scoped>
.language-select { max-width: 12rem; }
</style>
