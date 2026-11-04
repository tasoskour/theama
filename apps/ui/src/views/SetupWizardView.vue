<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { DetectedServices, type SubtitleProviderId } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { useConnectionStore } from '@/stores/connection'
import { useDownloadsStore } from '@/stores/downloads'
import { useMetadataStore } from '@/stores/metadata'
import { useSetupStore } from '@/stores/setup'
import { useSubtitlesStore } from '@/stores/subtitles'
import { useSetupStatus } from '@/composables/useSetupStatus'
import { SETUP_ITEMS, type SetupItem } from '@/setup/content'
import { ITEM_CONTENT } from '@/setup/items'
import SetupServiceCard from '@/components/setup/SetupServiceCard.vue'
import SetupLanguageSelect from '@/components/setup/SetupLanguageSelect.vue'
import logoMark from '@/assets/logo-mark.svg'

const { t } = useI18n()
const router = useRouter()
const setup = useSetupStore()
const connection = useConnectionStore()
const metadata = useMetadataStore()
const downloads = useDownloadsStore()
const subtitles = useSubtitlesStore()
const { statuses, refresh } = useSetupStatus()

const statusOf = (item: SetupItem) => statuses.value[ITEM_CONTENT[item].status] ?? 'unavailable'
const overrides = reactive<Partial<Record<SetupItem, boolean>>>({})
// Configured and skipped items stay folded; everything else is open so the next action is obvious.
const isOpen = (item: SetupItem): boolean => overrides[item] ?? !['configured', 'skipped'].includes(statusOf(item))
const toggle = (item: SetupItem): void => { overrides[item] = !isOpen(item) }
function skip(item: SetupItem): void { setup.setSkipped(item, true); overrides[item] = false }
function unskip(item: SetupItem): void { setup.setSkipped(item, false); overrides[item] = true }
const allConfigured = computed(() => SETUP_ITEMS.every((i) => statusOf(i) === 'configured'))
const disabled = computed(() => !connection.isConnected)
const configuredCount = computed(() => SETUP_ITEMS.filter((i) => statusOf(i) === 'configured').length)
// Found on this computer (desktop app) or already answering as connected.
const foundApps = ref<Partial<Record<'prowlarr' | 'qbittorrent', boolean>>>({})
const installed = computed(() => ({
  prowlarr: foundApps.value.prowlarr === true || statusOf('prowlarr') === 'configured',
  qbittorrent: foundApps.value.qbittorrent === true || statusOf('qbittorrent') === 'configured',
}))

const busy = reactive<Record<SetupItem, boolean>>({ tmdb: false, prowlarr: false, qbittorrent: false, subtitles: false })
const problem = reactive<Record<SetupItem, string | null>>({ tmdb: null, prowlarr: null, qbittorrent: null, subtitles: null })
const notice = reactive<Record<SetupItem, string | null>>({ tmdb: null, prowlarr: null, qbittorrent: null, subtitles: null })

async function run(item: SetupItem, work: () => Promise<string | null>): Promise<void> {
  if (busy[item]) return
  busy[item] = true; problem[item] = null; notice[item] = null
  try {
    const error = await work()
    problem[item] = error
    if (!error) { overrides[item] = undefined; setup.setSkipped(item, false); void refresh() }
  } catch (err) { problem[item] = err instanceof Error ? err.message : String(err) }
  finally { busy[item] = false }
}

// --- TMDB ---
const tmdbKey = ref('')
const saveTmdb = () => run('tmdb', async () => {
  const res = await metadata.saveKey(tmdbKey.value.trim())
  if (!res.ok) return res.code === 'invalid_key' ? t('metadata.keyRejected') : res.message
  tmdbKey.value = ''
  return null
})

// --- Prowlarr ---
const pUrl = ref('http://localhost:9696')
const pKey = ref('')
const savePr = () => run('prowlarr', async () => {
  const res = await downloads.saveIndexer({ url: pUrl.value.trim(), apiKey: pKey.value.trim() })
  if (!res.ok) return res.code === 'invalid_credentials' ? t('downloads.prowlarr.rejected') : res.code === 'invalid_request' ? t('downloads.badAddress') : res.message
  pKey.value = ''
  return null
})
const addIndexers = () => run('prowlarr', async () => {
  const res = await downloads.addRecommendedIndexers()
  if (!res.ok) return res.message
  const { added, existing, failed } = res.value
  notice.prowlarr = [added.length ? t('setup.items.prowlarr.added', { names: added.join(', ') }) : '', existing.length ? t('setup.items.prowlarr.existing', { names: existing.join(', ') }) : ''].filter(Boolean).join(' ')
  return failed.length ? failed.map((f) => `${f.name}: ${f.reason}`).join(' · ') : null
})

// --- qBittorrent ---
const qUrl = ref('http://localhost:8080')
const qUser = ref('')
const qPass = ref('')
const saveQb = () => run('qbittorrent', async () => {
  const res = await downloads.saveClient({ url: qUrl.value.trim(), username: qUser.value.trim(), password: qPass.value })
  if (!res.ok) return res.code === 'invalid_credentials' ? t('downloads.qb.rejected') : res.code === 'invalid_request' ? t('downloads.badAddress') : res.message
  qPass.value = ''
  return null
})

// --- Subtitles ---
const provider = ref<SubtitleProviderId>('opensubtitles')
const subKey = ref('')
const saveSub = () => run('subtitles', async () => {
  try { await subtitles.setKey(provider.value, subKey.value.trim()) } catch { return t('setup.items.subtitles.rejected') }
  subKey.value = ''
  return null
})
const providerItems = [{ title: 'OpenSubtitles', value: 'opensubtitles' }, { title: 'SubDL', value: 'subdl' }]

// --- Detection of installed apps (desktop only) ---
const detectedNote = ref<Partial<Record<SetupItem, boolean>>>({})
onMounted(async () => {
  setup.start()
  try {
    const found = DetectedServices.parse(await getBridge()?.downloadTools.detect())
    foundApps.value = { prowlarr: found.prowlarr.installed, qbittorrent: found.qbittorrent.installed }
    if (found.prowlarr.url && found.prowlarr.apiKey) { pUrl.value = found.prowlarr.url; pKey.value = found.prowlarr.apiKey; detectedNote.value.prowlarr = true }
    if (found.qbittorrent.url) { qUrl.value = found.qbittorrent.url; qUser.value = found.qbittorrent.username ?? ''; detectedNote.value.qbittorrent = true }
    if (found.qbittorrent.webUiEnabled === false) notice.qbittorrent = t('setup.items.qbittorrent.webUiOff')
  } catch { /* browser, or nothing installed */ }
})

function finish(): void { setup.complete(); void router.push('/') }
function skipAll(): void {
  for (const item of SETUP_ITEMS) if (statusOf(item) !== 'configured') setup.setSkipped(item, true)
  finish()
}
</script>

<template>
  <div class="th-page wizard" data-test="setup-wizard">
    <header class="hero">
      <img class="logo" :src="logoMark" alt="" />
      <div class="hero-text">
        <h1 class="th-display">{{ $t('setup.title') }}</h1>
        <p class="th-muted">{{ $t('setup.pageIntro') }}</p>
      </div>
      <SetupLanguageSelect />
    </header>
    <div class="progress" data-test="setup-progress">
      <span>{{ $t('setup.progressCount', { done: configuredCount, total: SETUP_ITEMS.length }) }}</span>
      <v-progress-linear :model-value="(configuredCount / SETUP_ITEMS.length) * 100" color="success" rounded height="8" :aria-label="$t('setup.progress')" />
    </div>
    <v-alert v-if="!setup.storageAvailable" type="warning" variant="tonal">{{ $t('setup.storageWarning') }}</v-alert>
    <v-alert v-if="disabled" type="info" variant="tonal">{{ $t('setup.backendRequired') }}</v-alert>
    <v-alert v-else-if="allConfigured" type="success" variant="tonal" data-test="setup-all-done">{{ $t('setup.allDone') }}</v-alert>

    <SetupServiceCard item="tmdb" :installed="installed" :status="statusOf('tmdb')" :open="isOpen('tmdb')" @toggle="toggle('tmdb')" @skip="skip('tmdb')" @unskip="unskip('tmdb')">
      <form class="form" @submit.prevent="saveTmdb">
        <v-text-field v-model="tmdbKey" type="password" :label="$t('setup.items.tmdb.apiKey')" autocomplete="off" spellcheck="false" :error-messages="problem.tmdb ?? undefined" :disabled="disabled" data-test="setup-tmdb-key" />
        <div><v-btn type="submit" color="primary" :loading="busy.tmdb" :disabled="disabled || !tmdbKey.trim()">{{ $t('setup.save') }}</v-btn></div>
      </form>
    </SetupServiceCard>

    <SetupServiceCard item="prowlarr" :installed="installed" :status="statusOf('prowlarr')" :open="isOpen('prowlarr')" @toggle="toggle('prowlarr')" @skip="skip('prowlarr')" @unskip="unskip('prowlarr')">
      <p v-if="detectedNote.prowlarr" class="th-muted">{{ $t('setup.detected') }}</p>
      <form class="form" @submit.prevent="savePr">
        <v-text-field v-model="pUrl" :label="$t('downloads.address')" spellcheck="false" autocomplete="off" :disabled="disabled" data-test="setup-prowlarr-url" />
        <v-text-field v-model="pKey" type="password" :label="$t('downloads.prowlarr.apiKey')" autocomplete="off" :error-messages="problem.prowlarr ?? undefined" :disabled="disabled" data-test="setup-prowlarr-key" />
        <div class="row">
          <v-btn type="submit" color="primary" :loading="busy.prowlarr" :disabled="disabled || !pUrl.trim() || pKey.trim().length < 8">{{ $t('setup.save') }}</v-btn>
          <v-btn variant="tonal" :loading="busy.prowlarr" :disabled="disabled || statusOf('prowlarr') !== 'configured'" data-test="setup-add-indexers" @click="addIndexers">{{ $t('setup.items.prowlarr.addIndexers') }}</v-btn>
        </div>
      </form>
      <p v-if="downloads.indexer?.indexers?.length" class="th-muted">{{ $t('setup.items.prowlarr.current', { names: downloads.indexer.indexers.join(', ') }) }}</p>
      <p v-if="notice.prowlarr">{{ notice.prowlarr }}</p>
    </SetupServiceCard>

    <SetupServiceCard item="qbittorrent" :installed="installed" :status="statusOf('qbittorrent')" :open="isOpen('qbittorrent')" @toggle="toggle('qbittorrent')" @skip="skip('qbittorrent')" @unskip="unskip('qbittorrent')">
      <p v-if="detectedNote.qbittorrent" class="th-muted">{{ $t('setup.detected') }}</p>
      <v-alert v-if="notice.qbittorrent" type="warning" variant="tonal" density="compact">{{ notice.qbittorrent }}</v-alert>
      <form class="form" @submit.prevent="saveQb">
        <v-text-field v-model="qUrl" :label="$t('downloads.address')" spellcheck="false" autocomplete="off" :disabled="disabled" data-test="setup-qb-url" />
        <v-text-field v-model="qUser" :label="$t('downloads.username')" spellcheck="false" autocomplete="off" :disabled="disabled" data-test="setup-qb-user" />
        <v-text-field v-model="qPass" type="password" :label="$t('downloads.password')" :hint="$t('downloads.passwordHint')" persistent-hint autocomplete="off" :error-messages="problem.qbittorrent ?? undefined" :disabled="disabled" data-test="setup-qb-pass" />
        <div><v-btn type="submit" color="primary" :loading="busy.qbittorrent" :disabled="disabled || !qUrl.trim()">{{ $t('setup.save') }}</v-btn></div>
      </form>
    </SetupServiceCard>

    <SetupServiceCard item="subtitles" :installed="installed" :status="statusOf('subtitles')" :open="isOpen('subtitles')" @toggle="toggle('subtitles')" @skip="skip('subtitles')" @unskip="unskip('subtitles')">
      <form class="form" @submit.prevent="saveSub">
        <v-select v-model="provider" :items="providerItems" :label="$t('setup.items.subtitles.provider')" :disabled="disabled" />
        <v-text-field v-model="subKey" type="password" :label="$t('setup.items.subtitles.apiKey')" autocomplete="off" spellcheck="false" :error-messages="problem.subtitles ?? undefined" :disabled="disabled" data-test="setup-sub-key" />
        <div><v-btn type="submit" color="primary" :loading="busy.subtitles" :disabled="disabled || !subKey.trim()">{{ $t('setup.save') }}</v-btn></div>
      </form>
    </SetupServiceCard>

    <footer class="actions">
      <v-btn color="primary" data-test="setup-done" @click="finish">{{ $t('setup.done') }}</v-btn>
      <v-btn variant="text" data-test="setup-later" @click="skipAll">{{ $t('setup.skipAll') }}</v-btn>
      <v-btn variant="text" :to="{ path: '/settings/setup' }">{{ $t('setup.guideTitle') }}</v-btn>
    </footer>
  </div>
</template>

<style scoped>
.wizard { max-width: 900px; margin: 0 auto; display: grid; gap: 20px; }
h1 { font-size: clamp(1.6rem, 3vw, 2.4rem); margin: 0 0 6px; }
.hero { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 20px; }
.hero-text { flex: 1 1 18rem; min-width: 0; }
.hero-text p { margin: 0; max-width: 70ch; }
.logo { width: 56px; height: 56px; flex: none; }
.progress { display: grid; gap: 6px; font-size: .9rem; }
.form { display: grid; gap: 8px; max-width: 35rem; }
.row, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.actions { position: sticky; bottom: 0; z-index: 1; padding: 14px 0; border-top: 1px solid rgb(var(--v-theme-hairline)); background: rgb(var(--v-theme-background)); }
</style>
