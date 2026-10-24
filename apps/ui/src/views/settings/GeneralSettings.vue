<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { TextSize, type DesktopSettings, type GraphicsQuality, type LogDetail, type ThemePreference, type UiLanguage, type VisualMode } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useImmersive } from '@/composables/useImmersive'
import BackdropGallery from './BackdropGallery.vue'
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
const textSizeItems = computed(() => TextSize.options.map((value) => ({ value, title: t(`settings.general.textSizes.${value}`) })))
const visualModes: VisualMode[] = ['standard', 'immersive']
const qualities: GraphicsQuality[] = ['low', 'medium', 'high']
const immersive = useImmersive()
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

    <div class="field th-form-section" data-test="text-size">
      <label id="text-size-label" class="label" for="text-size">{{ $t('settings.general.textSize') }}</label>
      <v-select
        id="text-size"
        :model-value="store.settings.textSize"
        :items="textSizeItems"
        :disabled="store.saving"
        aria-labelledby="text-size-label"
        aria-describedby="text-size-hint"
        class="text-size-select"
        data-test="text-size-select"
        @update:model-value="(v: TextSize) => save({ textSize: v })"
      />
      <p id="text-size-hint" class="th-muted hint">{{ $t('settings.general.textSizeHint') }}</p>
      <p class="text-size-preview" data-test="text-size-preview">{{ $t('settings.general.textSizePreview') }}</p>
    </div>

    <div class="field th-form-section" data-test="visual-mode">
      <span id="visual-mode" class="label">{{ $t('settings.general.visualMode') }}</span>
      <v-btn-toggle
        :model-value="store.settings.visualMode"
        mandatory
        divided
        color="primary"
        variant="outlined"
        aria-labelledby="visual-mode"
        @update:model-value="(v: VisualMode) => save({ visualMode: v })"
      >
        <v-btn
          v-for="m in visualModes"
          :key="m"
          :value="m"
          :disabled="m === 'immersive' && immersive.block.value === 'webgl'"
          :aria-pressed="store.settings.visualMode === m"
          :data-test="`visual-mode-${m}`"
        >{{ $t(`settings.general.visualModes.${m}`) }}</v-btn>
      </v-btn-toggle>
      <p class="th-muted hint">{{ $t('settings.general.visualModeHint') }}</p>
      <p v-if="immersive.wanted.value && immersive.block.value" class="hint" role="status" data-test="immersive-unavailable">
        {{ $t(`settings.general.immersiveUnavailable.${immersive.block.value}`) }}
      </p>
    </div>

    <div v-if="immersive.active.value" class="field th-form-section" data-test="backdrop-section">
      <BackdropGallery @choose="(patch) => save(patch)" />
    </div>

    <div v-if="store.settings.visualMode === 'immersive'" class="field th-form-section" data-test="graphics-quality">
      <span id="graphics-quality" class="label">{{ $t('settings.general.graphicsQuality') }}</span>
      <v-btn-toggle
        :model-value="store.settings.graphicsQuality"
        mandatory
        divided
        color="primary"
        variant="outlined"
        aria-labelledby="graphics-quality"
        @update:model-value="(v: GraphicsQuality) => save({ graphicsQuality: v })"
      >
        <v-btn v-for="q in qualities" :key="q" :value="q" :aria-pressed="store.settings.graphicsQuality === q">{{ $t(`settings.general.qualities.${q}`) }}</v-btn>
      </v-btn-toggle>
      <p class="th-muted hint">{{ $t('settings.general.graphicsQualityHint') }}</p>
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
.text-size-select {
  width: 100%;
  max-width: 20rem;
  min-width: 0;
}
.text-size-preview {
  margin: 8px 0 0;
  font-size: 1rem;
  line-height: 1.6;
}
.field > :deep(.v-btn-toggle) {
  flex-wrap: wrap;
  height: auto;
  max-width: 100%;
}
</style>
