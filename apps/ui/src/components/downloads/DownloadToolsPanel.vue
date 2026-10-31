<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiChevronDown, mdiMapMarkerOutline, mdiRefresh, mdiShieldAlert, mdiShieldCheck, mdiShieldOffOutline, mdiShieldOutline } from '@mdi/js'
import { DownloadTool } from '@theama/contracts'
import { useDownloadToolsStore, isLocalDownloadAddress } from '@/stores/downloadTools'
import { useDownloadsStore } from '@/stores/downloads'
import { toolLogos } from './toolLogos'

defineProps<{ settings?: boolean }>()
const { locale } = useI18n()
const tools = useDownloadToolsStore()
const downloads = useDownloadsStore()
const remote = computed(() => !isLocalDownloadAddress(downloads.client?.url))
const state = computed(() => remote.value ? 'unknown' : tools.vpnState)
const warning = computed(() => state.value !== 'connected' && (remote.value || tools.qbRunning !== false))
const reason = computed(() => remote.value ? 'remote' : tools.vpnReason)
// Only the first check of the session has nothing to show; every later one updates quietly in the background.
const loading = computed(() => !remote.value && tools.initializing)
const color = computed(() => warning.value ? 'warning' : state.value === 'connected' ? 'success' : 'info')
const icon = computed(() => {
  if (loading.value) return mdiShieldOutline
  if (state.value === 'connected') return mdiShieldCheck
  if (warning.value) return mdiShieldAlert
  return state.value === 'disconnected' ? mdiShieldOffOutline : mdiShieldOutline
})
const showDetails = ref(false)
const problem = computed(() => !loading.value && state.value !== 'connected')

const place = computed(() => {
  const location = state.value === 'connected' ? tools.vpnLocation : null
  if (!location) return null
  let country = location.country
  try { if (location.countryCode) country = new Intl.DisplayNames([locale.value], { type: 'region' }).of(location.countryCode) ?? country } catch { /* Keep the name the API gave. */ }
  return location.city ? `${country} · ${location.city}` : country
})

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
  <section class="tools mb-3" :aria-label="$t('downloads.tools.heading')" data-test="download-tools">
    <template v-if="tools.available">
      <div class="bar" :class="`bar--${color}`">
        <span class="bar__badge" :class="{ 'bar__badge--loading': loading }" aria-hidden="true">
          <v-icon :icon="icon" size="18" />
        </span>
        <div class="bar__status" :role="warning ? 'alert' : 'status'" aria-live="polite" data-test="vpn-status">
          <template v-if="loading"><span class="th-muted">{{ $t('downloads.tools.vpn.checking') }}</span></template>
          <template v-else>
            <strong class="bar__title">{{ $t(`downloads.tools.vpn.${state}`) }}</strong>
            <span v-if="place" class="bar__place" :title="$t('downloads.tools.location', { place })" data-test="vpn-location">
              <v-icon :icon="mdiMapMarkerOutline" size="14" aria-hidden="true" />{{ place }}
            </span>
            <span v-else-if="warning" class="bar__warning" data-test="vpn-warning">{{ $t(remote ? 'downloads.tools.remoteWarning' : 'downloads.tools.warning') }}</span>
          </template>
        </div>
        <v-btn
          v-if="problem"
          variant="text"
          size="x-small"
          :append-icon="mdiChevronDown"
          :class="{ 'bar__more--open': showDetails }"
          :aria-expanded="showDetails"
          aria-controls="vpn-details"
          data-test="vpn-details-toggle"
          @click="showDetails = !showDetails"
        >{{ $t(showDetails ? 'downloads.tools.hideDetails' : 'downloads.tools.details') }}</v-btn>

        <div class="bar__apps">
          <v-btn
            v-for="tool in DownloadTool.options"
            :key="tool"
            :variant="tool === 'nordvpn' && problem ? 'tonal' : 'text'"
            :color="tool === 'nordvpn' && problem ? 'warning' : undefined"
            size="small"
            class="app"
            :loading="tools.opening[tool] === true"
            :disabled="tools.opening[tool] === true"
            :aria-label="$t(`downloads.tools.openLabel.${tool}`)"
            :title="$t(`downloads.tools.openLabel.${tool}`)"
            :data-test="`open-${tool}`"
            @click="open(tool)"
          >
            <img :src="toolLogos[tool]" alt="" class="app__logo" width="18" height="18">
            <span class="app__label">{{ $t(`downloads.tools.open.${tool}`) }}</span>
          </v-btn>
          <v-btn
            icon
            variant="text"
            size="small"
            :loading="tools.manualChecking"
            :disabled="tools.manualChecking"
            :aria-label="$t('downloads.tools.refresh')"
            :title="$t('downloads.tools.refresh')"
            data-test="vpn-refresh"
            @click="tools.recheck()"
          ><v-icon :icon="mdiRefresh" size="18" /></v-btn>
        </div>
      </div>

      <v-expand-transition>
        <div v-show="problem && showDetails" id="vpn-details" class="details" data-test="vpn-details">
          <p>{{ $t(`downloads.tools.reason.${reason}`) }}</p>
          <p v-if="!remote">{{ $t('downloads.tools.fix') }}</p>
        </div>
      </v-expand-transition>
      <p v-if="tools.problem" role="alert" class="text-error mt-2" data-test="tool-error">{{ $t(`downloads.tools.error.${tools.problem}`) }}</p>
      <p v-if="settings" class="th-muted mt-2">{{ $t('downloads.tools.splitTunneling') }}</p>
    </template>
    <p v-else class="th-muted" role="status">{{ $t('downloads.tools.desktopOnly') }}</p>
  </section>
</template>

<style scoped>
.bar {
  --accent: rgb(var(--v-theme-info));
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  min-height: 48px;
  padding: 6px 8px 6px 12px;
  border: 1px solid rgba(var(--v-theme-hairline), 0.82);
  border-left: 3px solid var(--accent);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-light));
}
.bar--warning { --accent: rgb(var(--v-theme-warning)); }
.bar--success { --accent: rgb(var(--v-theme-success)); }

.bar__badge {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
.bar__badge--loading::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 2px solid var(--accent);
  opacity: 0;
  animation: pulse 1.6s ease-out infinite;
}
@keyframes pulse {
  0% { transform: scale(0.85); opacity: 0.7; }
  100% { transform: scale(1.5); opacity: 0; }
}

.bar__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
  min-width: 0;
  flex: 1 1 240px;
}
.bar__warning { color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.bar__place {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.bar__more--open :deep(.v-btn__append) { transform: rotate(180deg); }

.bar__apps {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.app__logo { display: block; flex: none; }
.app__label { margin-left: 8px; }

.details {
  margin-top: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.875rem;
  background: rgba(var(--v-theme-surface-light), 0.6);
}
.details p + p { margin-top: 4px; }

/* Narrow windows keep the logos and drop the words; the label and tooltip still name each app. */
@media (max-width: 760px) {
  .app__label { display: none; }
  .app { min-width: 36px; padding: 0 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .bar__badge--loading::after { animation: none; opacity: 0.5; transform: scale(1.2); }
}
</style>
