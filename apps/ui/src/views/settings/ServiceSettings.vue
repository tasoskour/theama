<script setup lang="ts">
import { onMounted, watch } from 'vue'
import ServiceControls from '@/components/service/ServiceControls.vue'
import ServiceStatusCard from '@/components/service/ServiceStatusCard.vue'
import { useConnectionStore } from '@/stores/connection'
import { useServiceStore } from '@/stores/service'

const service = useServiceStore()
const connection = useConnectionStore()

service.watchStatus()
onMounted(() => void service.loadEvents().catch(() => undefined))
watch(
  () => connection.phase,
  (p) => {
    if (p === 'connected') void service.loadEvents().catch(() => undefined)
  },
)

const KIND_COLOR: Record<string, string> = { start: 'success', stop: 'secondary', crash: 'error', restart: 'info', migrate: 'info' }
</script>

<template>
  <section>
    <h3 class="th-display title">{{ $t('service.title') }}</h3>
    <p class="th-muted mb-6">{{ $t('service.description') }}</p>

    <v-alert v-if="!service.supported" type="info" variant="tonal">{{ $t('service.needsDesktop') }}</v-alert>
    <template v-else>
      <ServiceStatusCard />
      <div class="mt-4"><ServiceControls /></div>
      <v-alert
        v-if="service.lastResult"
        :type="service.lastResult.ok ? 'success' : 'error'"
        variant="tonal"
        density="compact"
        class="mt-4"
        closable
        @click:close="service.lastResult = null"
      >
        {{ service.lastResult.ok ? $t('service.result.ok') : $t('service.result.failed') }}
        <template v-if="service.lastResult.message">: {{ service.lastResult.message }}</template>
      </v-alert>
      <p class="th-muted text-caption mt-4">{{ $t('service.elevation') }}</p>
    </template>

    <h3 class="th-display title mt-10">{{ $t('service.history.title') }}</h3>
    <p v-if="service.events.length === 0" class="th-muted">{{ $t('service.history.empty') }}</p>
    <v-table v-else density="comfortable" class="th-hairline history">
      <thead>
        <tr>
          <th>{{ $t('service.history.time') }}</th>
          <th>{{ $t('service.history.event') }}</th>
          <th>{{ $t('service.history.reason') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in service.events" :key="e.id">
          <td class="th-mono">{{ $d(new Date(e.time), 'short') }}</td>
          <td>
            <v-chip :color="KIND_COLOR[e.kind] ?? 'secondary'" size="small" label variant="tonal">{{ $t(`service.history.kind.${e.kind}`) }}</v-chip>
          </td>
          <td class="th-muted">{{ e.reason }}</td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
.title {
  font-size: 1.25rem;
  margin: 0 0 8px;
}
.history {
  background: rgb(var(--v-theme-surface));
  border-radius: var(--th-radius);
}
/* The reason is free text; give it room and let it wrap rather than stretching the table. */
.history td:last-child {
  min-width: 12rem;
  white-space: normal;
  overflow-wrap: anywhere;
}
.history td:first-child {
  white-space: nowrap;
}
</style>
