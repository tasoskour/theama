<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { mdiFolderOpenOutline } from '@mdi/js'
import { SystemInfo, type AppInfo, type UpdateState } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useConnectionStore } from '@/stores/connection'
import { useI18n } from 'vue-i18n'

const connection = useConnectionStore()
const { t } = useI18n()
const reportState = ref<'idle' | 'busy' | 'copied' | 'failed'>('idle')
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

async function copyReport(): Promise<void> {
  if (!connection.client) return
  reportState.value = 'busy'
  try {
    await navigator.clipboard.writeText(await connection.client.getText('/diagnostics/report'))
    reportState.value = 'copied'
  } catch {
    reportState.value = 'failed'
  }
}

const update = ref<UpdateState | null>(null)
let stopUpdates: (() => void) | undefined
const updateBusy = computed(() => update.value?.status === 'checking' || update.value?.status === 'downloading')

async function checkForUpdates(): Promise<void> {
  if (bridge) update.value = await bridge.updates.check()
}

onMounted(() => {
  void load()
  if (!bridge) return
  void bridge.updates.state().then((s) => (update.value = s))
  stopUpdates = bridge.updates.onState((s) => (update.value = s))
})
onBeforeUnmount(() => stopUpdates?.())
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

    <div v-if="bridge && update && update.status !== 'disabled'" class="diag" data-test="updates">
      <h3 class="th-display diag__title">{{ $t('settings.about.updates') }}</h3>
      <p class="th-muted diag__hint" role="status">
        <template v-if="update.status === 'checking'">{{ t('settings.about.updateChecking') }}</template>
        <template v-else-if="update.status === 'downloading'">{{ t('settings.about.updateDownloading', { version: update.version, percent: update.percent ?? 0 }) }}</template>
        <template v-else-if="update.status === 'ready'">{{ t('settings.about.updateReady', { version: update.version }) }}</template>
        <template v-else-if="update.status === 'up-to-date'">{{ t('settings.about.updateUpToDate') }}</template>
        <template v-else-if="update.status === 'error'">{{ t('settings.about.updateFailed') }}</template>
        <template v-else>{{ t('settings.about.updatesHint') }}</template>
      </p>
      <v-btn v-if="update.status === 'ready'" color="primary" data-test="update-install" @click="bridge.updates.install()">{{ t('settings.about.updateInstall') }}</v-btn>
      <v-btn v-else variant="tonal" :loading="updateBusy" data-test="update-check" @click="checkForUpdates">{{ t('settings.about.updateCheck') }}</v-btn>
    </div>

    <div class="diag">
      <h3 class="th-display diag__title">{{ $t('settings.about.diagnostics') }}</h3>
      <p class="th-muted diag__hint">{{ $t('settings.about.diagnosticsHint') }}</p>
      <v-btn variant="tonal" :loading="reportState === 'busy'" :disabled="!connection.isConnected" data-test="copy-report" @click="copyReport">{{ $t('settings.about.copyReport') }}</v-btn>
      <span v-if="reportState === 'copied'" class="diag__state" role="status">{{ t('settings.about.reportCopied') }}</span>
      <span v-if="reportState === 'failed'" class="diag__state diag__state--bad" role="alert">{{ t('settings.about.reportFailed') }}</span>
    </div>
  </section>
</template>

<style scoped>
section {
  container: about / inline-size;
}
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
  overflow-wrap: anywhere;
}
/* Narrow or large-text windows: label above value, so values keep the full width. */
@container about (max-width: 34rem) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  dt {
    margin-top: 12px;
    font-size: 0.85rem;
  }
}
.diag {
  margin-top: 40px;
}
.diag__title {
  font-size: 1.2rem;
  margin: 0 0 8px;
}
.diag__hint {
  max-width: 64ch;
  margin: 0 0 12px;
  font-size: 0.9rem;
}
.diag__state {
  display: inline-block;
  margin: 8px 0 0 12px;
}
.diag__state--bad {
  color: rgb(var(--v-theme-error));
}
.path {
  display: flex;
  align-items: center;
  gap: 8px;
}
.path > .th-mono {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
