<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import TheamaAppShell from '@/components/shell/TheamaAppShell.vue'
import { useImmersiveRoot } from '@/composables/useImmersive'
import { useSettingsStore } from '@/stores/settings'
import { useAppTheme } from '@/theme/useAppTheme'
import { applyTextSize } from '@/theme/textSize'

const settings = useSettingsStore()
const route = useRoute()
const { t } = useI18n()

useAppTheme(() => settings.settings.theme)
// Runs during setup, before first render, and synchronously for previews and rollbacks.
watch(() => settings.settings.textSize, applyTextSize, { immediate: true, flush: 'sync' })
useImmersiveRoot()

watch(
  () => [route.meta.titleKey, settings.settings.language] as const,
  ([key]) => {
    document.title = key ? `${t(key)} · ${t('app.name')}` : t('app.name')
  },
  { immediate: true },
)
</script>

<template>
  <v-app>
    <TheamaAppShell />
  </v-app>
</template>
