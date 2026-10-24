<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiDownloadOutline, mdiPlay, mdiRestart, mdiStop, mdiTrashCanOutline, mdiWrenchOutline } from '@mdi/js'
import type { ServiceAccountChoice } from '@theama/contracts'
import { useServiceStore } from '@/stores/service'
import ServiceInstallDialog from './ServiceInstallDialog.vue'

const service = useServiceStore()
const dialog = ref(false)
const mode = ref<'install' | 'repair' | 'uninstall'>('install')

const state = computed(() => service.status?.state ?? 'unknown')
const installed = computed(() => state.value !== 'not-installed')
const running = computed(() => state.value === 'running')
const stopped = computed(() => state.value === 'stopped')
const pending = computed(() => state.value === 'start-pending' || state.value === 'stop-pending')
const isNssm = computed(() => service.status?.host === 'nssm')

function open(m: 'install' | 'repair' | 'uninstall'): void {
  mode.value = m
  dialog.value = true
}

function onConfirm(account: ServiceAccountChoice | null): void {
  if (mode.value === 'uninstall') void service.run('uninstall')
  else void service.run(mode.value, account ?? undefined)
}
</script>

<template>
  <div class="controls" role="group" :aria-label="$t('service.title')">
    <v-btn
      color="primary"
      :prepend-icon="mdiPlay"
      :disabled="!installed || running || pending || service.busy !== null"
      :loading="service.busy === 'start'"
      @click="service.run('start')"
    >
{{ $t('service.actions.start') }}
</v-btn>
    <v-btn
      variant="tonal"
      :prepend-icon="mdiStop"
      :disabled="!installed || stopped || pending || service.busy !== null"
      :loading="service.busy === 'stop'"
      @click="service.run('stop')"
    >
{{ $t('service.actions.stop') }}
</v-btn>
    <v-btn
      variant="tonal"
      :prepend-icon="mdiRestart"
      :disabled="!installed || pending || service.busy !== null"
      :loading="service.busy === 'restart'"
      @click="service.run('restart')"
    >
{{ $t('service.actions.restart') }}
</v-btn>

    <template v-if="isNssm || !installed">
      <v-divider vertical class="mx-1 controls__divider" />
      <v-btn
        v-if="!installed"
        variant="tonal"
        :prepend-icon="mdiDownloadOutline"
        :disabled="service.busy !== null"
        :loading="service.busy === 'install'"
        @click="open('install')"
      >
{{ $t('service.actions.install') }}
</v-btn>
      <template v-else>
        <v-btn variant="text" :prepend-icon="mdiWrenchOutline" :disabled="service.busy !== null" :loading="service.busy === 'repair'" @click="open('repair')">
          {{ $t('service.actions.repair') }}
        </v-btn>
        <v-btn variant="text" color="error" :prepend-icon="mdiTrashCanOutline" :disabled="service.busy !== null" :loading="service.busy === 'uninstall'" @click="open('uninstall')">
          {{ $t('service.actions.uninstall') }}
        </v-btn>
      </template>
    </template>

    <ServiceInstallDialog v-model="dialog" :mode="mode" @confirm="onConfirm" />
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
@media (max-width: 600px) {
  .controls__divider {
    display: none;
  }
}
</style>
