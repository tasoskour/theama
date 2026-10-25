<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { mdiDownloadCircleOutline, mdiRadar, mdiRefresh, mdiShieldLockOutline } from '@mdi/js'
import { DownloadTool } from '@theama/contracts'
import { useDownloadToolsStore, isLocalDownloadAddress } from '@/stores/downloadTools'
import { useDownloadsStore } from '@/stores/downloads'

defineProps<{ settings?: boolean }>()
const tools = useDownloadToolsStore()
const downloads = useDownloadsStore()
const remote = computed(() => !isLocalDownloadAddress(downloads.client?.url))
const state = computed(() => remote.value ? 'unknown' : tools.vpnState)
const warning = computed(() => state.value !== 'connected' && (remote.value || tools.qbRunning !== false))
const reason = computed(() => remote.value ? 'remote' : tools.vpnReason)
const color = computed(() => warning.value ? 'warning' : state.value === 'connected' ? 'success' : 'info')
const toolIcons: Record<DownloadTool, string> = {
  nordvpn: mdiShieldLockOutline,
  qbittorrent: mdiDownloadCircleOutline,
  prowlarr: mdiRadar
}

function visibility(): void {
  if (document.visibilityState === 'hidden') tools.stop()
  else tools.start()
}
function focus(): void {
  if (document.visibilityState !== 'hidden') { tools.start(); void tools.refresh() }
}
async function open(tool: DownloadTool): Promise<void> {
  if (await tools.open(tool)) await downloads.load()
}
onMounted(() => {
  if (!tools.available) return
  visibility()
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('focus', focus)
})
onBeforeUnmount(() => {
  tools.stop()
  document.removeEventListener('visibilitychange', visibility)
  window.removeEventListener('focus', focus)
})
</script>

<template>
  <section class="tools mb-4" :aria-label="$t('downloads.tools.heading')" data-test="download-tools">
    <template v-if="tools.available">
      <v-alert :type="color" variant="tonal" density="compact" :role="warning ? 'alert' : 'status'" aria-live="polite" data-test="vpn-status">
        <strong>{{ $t(`downloads.tools.vpn.${state}`) }}</strong>
        <p v-if="warning" class="mt-1" data-test="vpn-warning">{{ $t(remote ? 'downloads.tools.remoteWarning' : 'downloads.tools.warning') }}</p>
        <p v-if="state !== 'connected'" class="mt-1">{{ $t(`downloads.tools.reason.${reason}`) }}</p>
      </v-alert>
      <div class="tools__actions mt-2">
        <v-btn
          v-for="tool in DownloadTool.options"
          :key="tool"
          variant="tonal"
          size="small"
          :prepend-icon="toolIcons[tool]"
          :loading="tools.opening[tool] === true"
          :disabled="tools.opening[tool] === true"
          :data-test="`open-${tool}`"
          @click="open(tool)"
        >{{ $t(`downloads.tools.open.${tool}`) }}</v-btn>
        <v-btn variant="text" size="small" :prepend-icon="mdiRefresh" :loading="tools.checking" :disabled="tools.checking" data-test="vpn-refresh" @click="tools.refresh()">{{ $t('downloads.tools.refresh') }}</v-btn>
      </div>
      <p v-if="tools.problem" role="alert" class="mt-2" data-test="tool-error">{{ $t(`downloads.tools.error.${tools.problem}`) }}</p>
      <p v-if="settings" class="th-muted mt-2">{{ $t('downloads.tools.splitTunneling') }}</p>
    </template>
    <p v-else class="th-muted" role="status">{{ $t('downloads.tools.desktopOnly') }}</p>
  </section>
</template>

<style scoped>
.tools__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
