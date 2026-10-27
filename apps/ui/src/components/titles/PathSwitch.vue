<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { mdiCheck, mdiSwapHorizontal } from '@mdi/js'
import type { MediaFile } from '@theama/contracts'
import { formatBytes, resolutionLabel } from '@/utils/format'

defineProps<{
  /** Every file that plays this movie or episode. */
  variants: MediaFile[]
  /** The id of the file in use. */
  modelValue: number
  /** What the files play, for the screen-reader name of the button. */
  name: string
  /** Icon and count only, for a crowded episode row. */
  compact?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [id: number] }>()
const { t, locale } = useI18n()

function details(f: MediaFile): string {
  const state = f.state === 'source_offline' ? t('files.offline') : f.state === 'missing_unconfirmed' ? t('files.missing') : null
  return [resolutionLabel(f.width, f.height), formatBytes(f.size, locale.value), state].filter(Boolean).join(' · ')
}
</script>

<template>
  <v-menu location="bottom end" max-width="min(36rem, 92vw)">
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        size="small"
        variant="tonal"
        class="th-btn-quiet switch"
        :prepend-icon="mdiSwapHorizontal"
        :aria-label="$t('detail.switchPathAria', { name, n: variants.length })"
        :title="$t('detail.switchPath')"
        data-test="path-switch"
      ><template v-if="!compact">{{ $t('detail.switchPath') }}</template><span class="switch__count">{{ variants.length }}</span></v-btn>
    </template>
    <v-list density="compact" :aria-label="$t('detail.switchPath')">
      <v-list-item
        v-for="f in variants"
        :key="f.id"
        :active="f.id === modelValue"
        :title="f.path"
        :subtitle="details(f)"
        data-test="path-option"
        :aria-current="f.id === modelValue ? 'true' : undefined"
        @click="emit('update:modelValue', f.id)"
      >
        <template #title><span class="th-mono path">{{ f.path }}</span></template>
        <template #append><svg v-if="f.id === modelValue" class="th-icon" viewBox="0 0 24 24" role="img" :aria-label="$t('detail.pathInUse')"><path :d="mdiCheck" fill="currentColor" /></svg></template>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<style scoped>
.switch__count {
  margin-inline-start: 6px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
.path {
  display: block;
  font-size: 0.8rem;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
