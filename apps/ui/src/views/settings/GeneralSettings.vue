<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ThemePreference, UiLanguage } from '@theama/contracts'
import { SUPPORTED_LANGUAGES } from '@/i18n'
import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const store = useSettingsStore()
const connection = useConnectionStore()
const snackbar = ref(false)

const themes: ThemePreference[] = ['system', 'dark', 'light']
const retentionChoices = [7, 14, 30, 90]
const retentionItems = computed(() => retentionChoices.map((n) => ({ value: n, title: t('settings.general.days', n) })))

async function save(patch: Parameters<typeof store.update>[0]): Promise<void> {
  if (await store.update(patch)) snackbar.value = true
}
</script>

<template>
  <section>
    <h2 class="th-display section-title">{{ $t('settings.sections.general') }}</h2>

    <div class="field">
      <label class="label" for="lang">{{ $t('settings.general.language') }}</label>
      <v-btn-toggle
        :model-value="store.settings.language"
        mandatory
        divided
        color="primary"
        variant="outlined"
        aria-labelledby="lang"
        @update:model-value="(v: UiLanguage) => save({ language: v })"
      >
        <v-btn
          v-for="l in SUPPORTED_LANGUAGES"
          :id="l.code === 'en' ? 'lang' : undefined"
          :key="l.code"
          :value="l.code"
          :aria-pressed="store.settings.language === l.code"
        >{{ l.label }}</v-btn>
      </v-btn-toggle>
      <p class="th-muted hint">{{ $t('settings.general.languageHint') }}</p>
    </div>

    <div class="field">
      <span class="label">{{ $t('settings.general.theme') }}</span>
      <v-btn-toggle
        :model-value="store.settings.theme"
        mandatory
        divided
        color="primary"
        variant="outlined"
        @update:model-value="(v: ThemePreference) => save({ theme: v })"
      >
        <v-btn v-for="th in themes" :key="th" :value="th" :aria-pressed="store.settings.theme === th">{{ $t(`settings.general.themes.${th}`) }}</v-btn>
      </v-btn-toggle>
      <p class="th-muted hint">{{ $t('settings.general.themeHint') }}</p>
    </div>

    <div class="field">
      <span class="label">{{ $t('settings.general.logRetention') }}</span>
      <v-select
        :model-value="store.settings.logRetentionDays"
        :items="retentionItems"
        :disabled="!connection.isConnected"
        style="max-width: 220px"
        @update:model-value="(v: number) => save({ logRetentionDays: v })"
      />
      <p class="th-muted hint">{{ $t('settings.general.logRetentionHint') }}</p>
    </div>

    <v-alert v-if="store.error" type="error" variant="tonal" density="compact" class="mt-4">{{ store.error }}</v-alert>
    <v-snackbar v-model="snackbar" :timeout="2200" color="surface-bright">{{ $t('settings.general.saved') }}</v-snackbar>
  </section>
</template>

<style scoped>
.section-title {
  font-size: 1.6rem;
  margin: 0 0 24px;
}
.field {
  display: grid;
  gap: 8px;
  margin-bottom: 32px;
}
.label {
  font-weight: 600;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
}
</style>
