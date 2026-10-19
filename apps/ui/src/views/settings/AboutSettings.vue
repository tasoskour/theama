<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { mdiFolderOpenOutline } from '@mdi/js'
import { SystemInfo, type AppInfo } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useConnectionStore } from '@/stores/connection'

const connection = useConnectionStore()
const bridge = getBridge()
const info = ref<SystemInfo | null>(null)
const app = ref<AppInfo | null>(null)

async function load(): Promise<void> {
  if (connection.client) info.value = await connection.client.get('/system/info', SystemInfo).catch(() => null)
  if (bridge) app.value = await bridge.appInfo()
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${seconds % 60}s` : `${seconds}s`
}

onMounted(() => void load())
watch(() => connection.phase, (p) => p === 'connected' && void load())
</script>

<template>
  <section>
    <dl v-if="info" class="grid">
      <dt>{{ $t('settings.about.version') }}</dt>
      <dd>{{ info.version }}</dd>
      <template v-if="app">
        <dt>{{ $t('settings.about.desktop') }}</dt>
        <dd>{{ app.version }}</dd>
      </template>
      <dt>{{ $t('settings.about.nodeVersion') }}</dt>
      <dd>{{ info.nodeVersion }}</dd>
      <dt>{{ $t('settings.about.host') }}</dt>
      <dd>{{ info.hostMode === 'service' ? $t('settings.about.hostService') : $t('settings.about.hostForeground') }}</dd>
      <dt>{{ $t('settings.about.pid') }}</dt>
      <dd class="th-mono">{{ info.pid }}</dd>
      <dt>{{ $t('settings.about.uptime') }}</dt>
      <dd>{{ formatUptime(info.uptimeSeconds) }}</dd>
      <dt>{{ $t('settings.about.schema') }}</dt>
      <dd>v{{ info.schemaVersion }}</dd>
      <template
v-for="row in [
        { key: 'dataDir', path: info.paths.dataDir },
        { key: 'database', path: info.paths.databaseFile },
        { key: 'cache', path: info.paths.cacheDir },
        { key: 'logs', path: info.paths.logsDir },
      ]" :key="row.key">
        <dt>{{ $t(`settings.about.${row.key}`) }}</dt>
        <dd class="path">
          <span class="th-mono">{{ row.path }}</span>
          <v-btn
            v-if="bridge"
            icon
            size="x-small"
            variant="text"
            :aria-label="$t('common.openFolder')"
            @click="bridge.showItemInFolder(row.path)"
          >
<v-icon :icon="mdiFolderOpenOutline" />
</v-btn>
        </dd>
      </template>
    </dl>
    <p v-else class="th-muted">{{ $t('common.loading') }}</p>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 12px 32px;
  margin: 0;
}
dt {
  color: rgb(var(--v-theme-on-surface-variant));
}
dd {
  margin: 0;
  word-break: break-all;
}
.path {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
