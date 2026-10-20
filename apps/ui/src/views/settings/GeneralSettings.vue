<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DesktopSettings, LogDetail, ThemePreference, UiLanguage } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { SUPPORTED_LANGUAGES } from '@/i18n'
import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const store = useSettingsStore()
const connection = useConnectionStore()
const snackbar = ref(false)
const bridge = getBridge()

const logDetails: LogDetail[] = ['error', 'warn', 'info', 'debug']
const logDetailItems = computed(() => logDetails.map((d) => ({ value: d, title: t(`settings.general.logDetails.${d}`) })))

// What the desktop app does around its window is kept by the desktop app itself, not by the service.
const desktop = ref<DesktopSettings | null>(null)
onMounted(async () => {
  desktop.value = (await bridge?.desktop.get().catch(() => null)) ?? null
})
async function setDesktop(patch: { closeToTray?: boolean; startWithWindows?: boolean }): Promise<void> {
  if (!bridge) return
  desktop.value = await bridge.desktop.set(patch)
  snackbar.value = true
}

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

    <div class="field th-form-section">
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

    <div class="field th-form-section">
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

    <div class="field th-form-section">
      <span class="label">{{ $t('settings.general.logRetention') }}</span>
      <v-select
        :model-value="store.settings.logRetentionDays"
        :items="retentionItems"
        :aria-label="$t('settings.general.logRetention')"
        :disabled="!connection.isConnected"
        style="max-width: 220px"
        @update:model-value="(v: number) => save({ logRetentionDays: v })"
      />
      <p class="th-muted hint">{{ $t('settings.general.logRetentionHint') }}</p>
    </div>

    <div class="field th-form-section">
      <span class="label">{{ $t('settings.general.logDetail') }}</span>
      <v-select
        :model-value="store.settings.logDetail"
        :items="logDetailItems"
        :aria-label="$t('settings.general.logDetail')"
        :disabled="!connection.isConnected"
        style="max-width: 280px"
        @update:model-value="(v: LogDetail) => save({ logDetail: v })"
      />
      <p class="th-muted hint">{{ $t('settings.general.logDetailHint') }}</p>
    </div>

    <div v-if="desktop" class="field th-form-section" data-test="desktop-behaviour">
      <span class="label">{{ $t('settings.desktop.title') }}</span>
      <v-switch
        :model-value="desktop.closeToTray"
        :label="$t('settings.desktop.closeToTray')"
        color="primary"
        hide-details
        data-test="close-to-tray"
        @update:model-value="(v: boolean | null) => setDesktop({ closeToTray: v === true })"
      />
      <p class="th-muted hint">{{ $t('settings.desktop.closeToTrayHint') }}</p>
      <v-switch
        :model-value="desktop.startWithWindows"
        :label="$t('settings.desktop.startWithWindows')"
        :disabled="!desktop.startWithWindowsSupported"
        color="primary"
        hide-details
        data-test="start-with-windows"
        @update:model-value="(v: boolean | null) => setDesktop({ startWithWindows: v === true })"
      />
      <p class="th-muted hint">{{ $t(desktop.startWithWindowsSupported ? 'settings.desktop.startWithWindowsHint' : 'settings.desktop.startWithWindowsDev') }}</p>
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
