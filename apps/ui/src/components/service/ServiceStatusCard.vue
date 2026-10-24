<script setup lang="ts">
import { computed } from 'vue'
import type { ServiceState } from '@theama/contracts'
import { useServiceStore } from '@/stores/service'

const service = useServiceStore()
const status = computed(() => service.status)

const STATE_COLOR: Record<ServiceState, string> = {
  running: 'success',
  stopped: 'warning',
  'start-pending': 'info',
  'stop-pending': 'info',
  paused: 'warning',
  'not-installed': 'error',
  unknown: 'secondary',
}
</script>

<template>
  <v-card v-if="status" class="th-hairline pa-4">
    <div class="head">
      <v-chip :color="STATE_COLOR[status.state]" variant="tonal" label size="large">
        {{ $t(`service.state.${status.state}`) }}
      </v-chip>
      <span class="th-muted">{{ $t(`service.host.${status.host}`) }}</span>
    </div>
    <dl class="grid">
      <dt>{{ $t('service.fields.name') }}</dt>
      <dd class="th-mono">{{ status.serviceName }}</dd>
      <dt>{{ $t('service.fields.account') }}</dt>
      <dd>{{ status.account ?? $t('common.unknown') }}</dd>
      <dt>{{ $t('service.fields.pid') }}</dt>
      <dd class="th-mono">{{ status.pid ?? '—' }}</dd>
      <dt>{{ $t('service.fields.api') }}</dt>
      <dd>{{ status.apiReachable ? $t('service.api.reachable') : $t('service.api.unreachable') }}</dd>
    </dl>
    <v-alert v-if="status.detail" type="warning" variant="tonal" density="compact" class="mt-3">{{ status.detail }}</v-alert>
  </v-card>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.grid {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 24px;
  margin: 0;
}
dt {
  color: rgb(var(--v-theme-on-surface-variant));
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
