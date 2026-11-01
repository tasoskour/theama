<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DownloadTool } from '@theama/contracts'
import { useDownloadToolsStore } from '@/stores/downloadTools'
import { toolLogos } from './toolLogos'

const tools = useDownloadToolsStore()
// Kept through the closing transition so the text does not empty out while it fades.
const tool = ref<DownloadTool>('prowlarr')
watch(() => tools.prompt, (next) => { if (next) tool.value = next }, { immediate: true })
</script>

<template>
  <v-dialog
    :model-value="tools.prompt !== null"
    max-width="28rem"
    :persistent="tools.opening[tool] === true"
    aria-labelledby="open-tool-title"
    data-test="open-tool-dialog"
    @update:model-value="(v: boolean) => !v && tools.dismiss()"
  >
    <v-card>
      <v-card-title id="open-tool-title" class="th-display title">
        <img :src="toolLogos[tool]" alt="" width="24" height="24">
        {{ $t(`downloads.tools.prompt.title.${tool}`) }}
      </v-card-title>
      <v-card-text>
        <p>{{ $t(`downloads.tools.prompt.body.${tool}`) }}</p>
        <p v-if="tools.problem" role="alert" class="text-error mt-2" data-test="open-tool-error">{{ $t(`downloads.tools.error.${tools.problem}`) }}</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="tools.opening[tool] === true" data-test="open-tool-cancel" @click="tools.dismiss()">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="tools.opening[tool] === true" data-test="open-tool-confirm" @click="tools.confirm()">
          {{ $t(`downloads.tools.openLabel.${tool}`) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.title img { flex: none; }
</style>
