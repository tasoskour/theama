<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiDownloadOutline, mdiPlay, mdiRefresh, mdiServerNetworkOff } from '@mdi/js'
import { useConnectionStore } from '@/stores/connection'
import { useLogsStore } from '@/stores/logs'
import { useServiceStore } from '@/stores/service'
import ServiceInstallDialog from './ServiceInstallDialog.vue'
import LogList from '@/components/logs/LogList.vue'
import type { ServiceAccountChoice } from '@theama/contracts'

const { t } = useI18n()
const connection = useConnectionStore()
const service = useServiceStore()
const logs = useLogsStore()
const installOpen = ref(false)

onMounted(() => {
  service.watchStatus()
  void logs.loadLocal(60)
})

const message = computed(() => {
  const s = service.status
  if (!service.supported) return t('recovery.needsDesktop')
  if (!s) return t('recovery.body')
  if (s.host === 'dev-process') return t('recovery.devProcess')
  switch (s.state) {
    case 'not-installed':
      return t('recovery.notInstalled')
    case 'stopped':
      return t('recovery.stopped')
    case 'start-pending':
      return t('recovery.startingUp')
    case 'running':
      return t('recovery.running')
    default:
      return t('recovery.body')
  }
})

const canInstall = computed(() => service.supported && service.status?.state === 'not-installed' && service.status.host === 'nssm')
const canStart = computed(() => service.supported && !canInstall.value)

async function start(): Promise<void> {
  await service.run('start')
  connection.retryNow()
}
async function install(account: ServiceAccountChoice | null): Promise<void> {
  await service.run('install', account ?? undefined)
  connection.retryNow()
}
</script>

<template>
  <div class="th-page recovery">
    <v-icon :icon="mdiServerNetworkOff" size="56" color="warning" />
    <h1 class="th-display title">{{ $t('recovery.title') }}</h1>
    <p class="th-muted lead">{{ $t('recovery.body') }}</p>
    <v-alert type="info" variant="tonal" class="state" density="comfortable">{{ message }}</v-alert>

    <div class="actions">
      <v-btn v-if="canStart" color="primary" :prepend-icon="mdiPlay" :loading="service.busy === 'start'" @click="start">
        {{ $t('recovery.start') }}
      </v-btn>
      <v-btn v-if="canInstall" color="primary" :prepend-icon="mdiDownloadOutline" @click="installOpen = true">
        {{ $t('recovery.install') }}
      </v-btn>
      <v-btn variant="tonal" :prepend-icon="mdiRefresh" @click="connection.retryNow()">{{ $t('recovery.retry') }}</v-btn>
    </div>

    <section v-if="service.lastResult && !service.lastResult.ok" class="mt-4 state">
      <v-alert type="error" variant="tonal" density="compact">
        {{ $t('service.result.failed') }}<template v-if="service.lastResult.message">: {{ service.lastResult.message }}</template>
      </v-alert>
    </section>

    <section class="logs">
      <h2 class="th-eyebrow mb-3">{{ $t('recovery.viewLogs') }}</h2>
      <p v-if="logs.items.length === 0" class="th-muted">{{ $t('recovery.noLogs') }}</p>
      <LogList v-else :items="logs.items" :height="260" />
    </section>

    <ServiceInstallDialog v-model="installOpen" mode="install" @confirm="install" />
  </div>
</template>

<style scoped>
.recovery {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding-top: 64px;
}
.title {
  font-size: clamp(1.6rem, calc(3vw * var(--th-text-scale)), 2.2rem);
  margin: 8px 0 0;
}
.lead {
  max-width: 560px;
  margin: 0;
}
.state {
  width: min(560px, 100%);
  text-align: left;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
}
.logs {
  width: min(900px, 100%);
  margin-top: 32px;
  text-align: left;
}
</style>
