<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiFolderOpen } from '@mdi/js'
import { getBridge } from '@/api/bridge'
import { useConnectionStore } from '@/stores/connection'
import { useDownloadsStore } from '@/stores/downloads'
import { isLocalDownloadAddress, useDownloadToolsStore } from '@/stores/downloadTools'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import DownloadToolsPanel from '@/components/downloads/DownloadToolsPanel.vue'
import { toolLogos } from '@/components/downloads/toolLogos'
import SetupHelpLink from '@/components/setup/SetupHelpLink.vue'

const { t } = useI18n()
const connection = useConnectionStore()
const downloads = useDownloadsStore()
const tools = useDownloadToolsStore()
const library = useLibraryStore()
const settings = useSettingsStore()

const snackbar = ref('')

// --- qBittorrent ---
const qbUrl = ref('http://localhost:8080')
const qbUser = ref('')
const qbPass = ref('')
const qbEditing = ref(false)
const qbSaving = ref(false)
const qbProblem = ref<string | null>(null)

const qb = computed(() => downloads.client)
const qbConfigured = computed(() => qb.value !== null && qb.value.state !== 'not_configured')
const showQbForm = computed(() => !qbConfigured.value || qbEditing.value)
// A configured local qBittorrent that does not answer while its app is seen closed: offer to open it instead of showing the error.
const qbClosed = computed(() =>
  tools.available && !showQbForm.value && qb.value?.state === 'unreachable' && isLocalDownloadAddress(qb.value.url) && tools.qbRunning === false)

async function openQb(): Promise<void> {
  if (await tools.open('qbittorrent')) await downloads.load()
}

function startQbEdit(): void {
  qbUrl.value = qb.value?.url ?? qbUrl.value
  qbUser.value = qb.value?.username ?? qbUser.value
  qbPass.value = ''
  qbProblem.value = null
  qbEditing.value = true
}

async function saveQb(): Promise<void> {
  if (qbSaving.value) return
  qbSaving.value = true
  qbProblem.value = null
  const res = await downloads.saveClient({ url: qbUrl.value.trim(), username: qbUser.value.trim(), password: qbPass.value })
  qbSaving.value = false
  if (res.ok) {
    qbPass.value = ''
    qbEditing.value = false
    snackbar.value = t('downloads.saved')
  } else {
    qbProblem.value = res.code === 'invalid_credentials' ? t('downloads.qb.rejected') : res.code === 'invalid_request' ? t('downloads.badAddress') : res.message
  }
}

async function removeQb(): Promise<void> {
  qbSaving.value = true
  const res = await downloads.saveClient(null)
  qbSaving.value = false
  if (res.ok) snackbar.value = t('downloads.removed')
  else qbProblem.value = res.message
}

// --- Prowlarr ---
const pUrl = ref('http://localhost:9696')
const pKey = ref('')
const pEditing = ref(false)
const pSaving = ref(false)
const pProblem = ref<string | null>(null)

const pr = computed(() => downloads.indexer)
const pConfigured = computed(() => pr.value !== null && pr.value.state !== 'not_configured')
const showPForm = computed(() => !pConfigured.value || pEditing.value)

function startPEdit(): void {
  pUrl.value = pr.value?.url ?? pUrl.value
  pKey.value = ''
  pProblem.value = null
  pEditing.value = true
}

async function saveP(): Promise<void> {
  if (pSaving.value) return
  pSaving.value = true
  pProblem.value = null
  const res = await downloads.saveIndexer({ url: pUrl.value.trim(), apiKey: pKey.value.trim() })
  pSaving.value = false
  if (res.ok) {
    pKey.value = ''
    pEditing.value = false
    snackbar.value = t('downloads.saved')
  } else {
    pProblem.value = res.code === 'invalid_credentials' ? t('downloads.prowlarr.rejected') : res.code === 'invalid_request' ? t('downloads.badAddress') : res.message
  }
}

async function removeP(): Promise<void> {
  pSaving.value = true
  const res = await downloads.saveIndexer(null)
  pSaving.value = false
  if (res.ok) snackbar.value = t('downloads.removed')
  else pProblem.value = res.message
}

function chipColor(state: string | undefined): string | undefined {
  if (state === 'connected') return 'success'
  if (state === 'unreachable' || state === 'auth_failed' || state === 'forbidden') return 'warning'
  return undefined
}

// --- Folders ---
const folderItems = (types: string[]) => [
  { value: null as number | null, title: t('downloads.folders.default') },
  ...library.sources.filter((s) => types.includes(s.libraryType)).map((s) => ({ value: s.id as number | null, title: s.path })),
]
const movieFolders = computed(() => folderItems(['movies', 'auto']))
const seriesFolders = computed(() => folderItems(['series', 'auto']))

async function setFolder(key: 'downloadMovieSourceId' | 'downloadSeriesSourceId', id: number | null): Promise<void> {
  if (await settings.update({ [key]: id })) snackbar.value = t('settings.general.saved')
}

const bridge = getBridge()
const canBrowse = bridge !== null

const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()

async function browseFolder(kind: 'movies' | 'series'): Promise<void> {
  const picked = await bridge?.pickFolder(t(`downloads.folders.${kind}`))
  if (!picked) return
  const key = kind === 'movies' ? 'downloadMovieSourceId' : 'downloadSeriesSourceId'
  const existing = library.sources.find((s) => norm(s.path) === norm(picked))
  if (existing) {
    await setFolder(key, existing.id)
    return
  }
  const res = await library.add(picked, kind)
  if (res.ok) await setFolder(key, res.source.id)
  else snackbar.value = res.message
}

onMounted(() => {
  void downloads.load()
  if (!library.loaded) void library.load()
})

defineExpose({ async saveForSetup(): Promise<boolean> {
  if (qbSaving.value || pSaving.value) return false
  if (showQbForm.value && (qbUser.value.trim() || qbPass.value || qbEditing.value || qbUrl.value.trim() !== 'http://localhost:8080')) await saveQb()
  if (qbProblem.value) return false
  if (showPForm.value && (pKey.value.trim() || pEditing.value || pUrl.value.trim() !== 'http://localhost:9696')) await saveP()
  return pProblem.value === null
} })
</script>

<template>
  <section>
    <h2 class="th-display section-title">{{ $t('settings.sections.downloads') }}</h2>
    <p class="intro">{{ $t('downloads.intro') }}</p>
    <SetupHelpLink topic="downloads" />
    <DownloadToolsPanel settings />

    <div class="field th-form-section" data-test="qb-section">
      <div class="label-row">
        <span id="qb-label" class="label">{{ $t('downloads.qb.name') }}</span>
        <v-chip v-if="qb && !showQbForm" size="small" label variant="tonal" :color="chipColor(qb.state)" data-test="qb-state">{{ $t(`downloads.state.${qb.state}`) }}</v-chip>
      </div>
      <p class="th-muted hint">{{ $t('downloads.qb.intro') }}</p>

      <form v-if="showQbForm" class="form" @submit.prevent="saveQb">
        <v-text-field v-model="qbUrl" :label="$t('downloads.address')" :hint="$t('downloads.qb.addressHint')" persistent-hint spellcheck="false" autocomplete="off" :disabled="!connection.isConnected" data-test="qb-url" />
        <v-text-field v-model="qbUser" :label="$t('downloads.username')" :hint="$t('downloads.usernameHint')" persistent-hint spellcheck="false" autocomplete="off" :disabled="!connection.isConnected" data-test="qb-user" />
        <v-text-field
          v-model="qbPass"
          type="password"
          :label="$t('downloads.password')"
          :hint="$t('downloads.passwordHint')"
          persistent-hint
          autocomplete="off"
          :error-messages="qbProblem ?? undefined"
          :disabled="!connection.isConnected"
          data-test="qb-pass"
        />
        <div class="actions">
          <v-btn type="submit" color="primary" :loading="qbSaving" :disabled="!qbUrl.trim() || !connection.isConnected" data-test="qb-save">{{ $t('downloads.connect') }}</v-btn>
          <v-btn v-if="qbEditing" variant="text" @click="qbEditing = false">{{ $t('common.cancel') }}</v-btn>
        </div>
      </form>
      <div v-else class="saved">
        <span>{{ qb?.url }} · {{ qb?.username || '—' }}<template v-if="qb?.version"> · qBittorrent {{ qb.version }}</template></span>
        <v-btn variant="tonal" size="small" @click="startQbEdit">{{ $t('downloads.edit') }}</v-btn>
        <v-btn variant="text" size="small" color="error" :loading="qbSaving" @click="removeQb">{{ $t('downloads.remove') }}</v-btn>
      </div>
      <v-alert v-if="qbClosed" type="warning" variant="tonal" density="compact" data-test="qb-closed">
        {{ $t('downloads.tools.prompt.title.qbittorrent') }}
        <template #append>
          <v-btn
            variant="tonal"
            size="small"
            :loading="tools.opening.qbittorrent === true"
            :disabled="tools.opening.qbittorrent === true"
            :aria-label="$t('downloads.tools.openLabel.qbittorrent')"
            data-test="qb-open"
            @click="openQb"
          >
            <img :src="toolLogos.qbittorrent" alt="" width="18" height="18" class="mr-2">
            {{ $t('downloads.tools.openLabel.qbittorrent') }}
          </v-btn>
        </template>
      </v-alert>
      <v-alert v-else-if="qbConfigured && !showQbForm && qb && qb.state !== 'connected' && qb.message" type="warning" variant="tonal" density="compact">
        {{ qb.message }}
        <template #append><v-btn variant="text" size="small" @click="downloads.load()">{{ $t('common.retry') }}</v-btn></template>
      </v-alert>
      <p class="th-muted hint">{{ $t('downloads.qb.webUiHint') }}</p>
    </div>

    <div class="field th-form-section" data-test="prowlarr-section">
      <div class="label-row">
        <span id="prowlarr-label" class="label">{{ $t('downloads.prowlarr.name') }}</span>
        <v-chip v-if="pr" size="small" label variant="tonal" :color="chipColor(pr.state)" data-test="prowlarr-state">{{ $t(`downloads.state.${pr.state}`) }}</v-chip>
      </div>
      <p class="th-muted hint">{{ $t('downloads.prowlarr.intro') }}</p>

      <form v-if="showPForm" class="form" @submit.prevent="saveP">
        <v-text-field v-model="pUrl" :label="$t('downloads.address')" spellcheck="false" autocomplete="off" :disabled="!connection.isConnected" data-test="prowlarr-url" />
        <v-text-field
          v-model="pKey"
          type="password"
          :label="$t('downloads.prowlarr.apiKey')"
          :hint="$t('downloads.prowlarr.apiKeyHint')"
          persistent-hint
          autocomplete="off"
          :error-messages="pProblem ?? undefined"
          :disabled="!connection.isConnected"
          data-test="prowlarr-key"
        />
        <div class="actions">
          <v-btn type="submit" color="primary" :loading="pSaving" :disabled="!pUrl.trim() || pKey.trim().length < 8 || !connection.isConnected" data-test="prowlarr-save">{{ $t('downloads.connect') }}</v-btn>
          <v-btn v-if="pEditing" variant="text" @click="pEditing = false">{{ $t('common.cancel') }}</v-btn>
        </div>
      </form>
      <div v-else class="saved">
        <span>{{ pr?.url }}<template v-if="pr?.version"> · Prowlarr {{ pr.version }}</template></span>
        <v-btn variant="tonal" size="small" @click="startPEdit">{{ $t('downloads.edit') }}</v-btn>
        <v-btn variant="text" size="small" color="error" :loading="pSaving" @click="removeP">{{ $t('downloads.remove') }}</v-btn>
      </div>
      <v-alert v-if="pConfigured && pr && pr.state !== 'connected' && pr.message" type="warning" variant="tonal" density="compact">{{ pr.message }}</v-alert>
    </div>

    <div class="field th-form-section">
      <span class="label">{{ $t('downloads.folders.title') }}</span>
      <p class="th-muted hint">{{ $t('downloads.folders.hint') }}</p>
      <div class="form">
        <v-switch
          v-if="canBrowse"
          :model-value="settings.settings.downloadAskFolder"
          :label="$t('downloads.folders.ask')"
          :hint="$t('downloads.folders.askHint')"
          persistent-hint
          color="primary"
          :disabled="!connection.isConnected"
          data-test="folder-ask"
          @update:model-value="(v: boolean | null) => settings.update({ downloadAskFolder: v === true })"
        />
        <div class="folder-row">
          <v-select
            :model-value="settings.settings.downloadMovieSourceId"
            :items="movieFolders"
            :label="$t('downloads.folders.movies')"
            :disabled="!connection.isConnected"
            data-test="folder-movies"
            @update:model-value="(v: number | null) => setFolder('downloadMovieSourceId', v)"
          />
          <v-btn v-if="canBrowse" variant="tonal" :prepend-icon="mdiFolderOpen" :disabled="!connection.isConnected" data-test="browse-movies" @click="browseFolder('movies')">{{ $t('downloads.folders.browse') }}</v-btn>
        </div>
        <div class="folder-row">
          <v-select
            :model-value="settings.settings.downloadSeriesSourceId"
            :items="seriesFolders"
            :label="$t('downloads.folders.series')"
            :disabled="!connection.isConnected"
            data-test="folder-series"
            @update:model-value="(v: number | null) => setFolder('downloadSeriesSourceId', v)"
          />
          <v-btn v-if="canBrowse" variant="tonal" :prepend-icon="mdiFolderOpen" :disabled="!connection.isConnected" data-test="browse-series" @click="browseFolder('series')">{{ $t('downloads.folders.browse') }}</v-btn>
        </div>
      </div>
    </div>

    <div class="field th-form-section">
      <span class="label">{{ $t('downloads.privacy') }}</span>
      <p class="th-muted hint">{{ $t('downloads.privacyText') }}</p>
    </div>

    <v-snackbar :model-value="snackbar !== ''" :timeout="2400" color="surface-bright" @update:model-value="snackbar = ''">{{ snackbar }}</v-snackbar>
  </section>
</template>

<style scoped>
.section-title {
  font-size: 1.6rem;
  margin: 0 0 12px;
}
.intro {
  max-width: 62ch;
  margin: 0 0 28px;
}
.field {
  display: grid;
  gap: 8px;
  margin-bottom: 32px;
}
.label {
  font-weight: 600;
}
.label-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  max-width: 62ch;
}
.form {
  display: grid;
  gap: 8px;
  max-width: 35rem;
}
.saved > span {
  flex: 1 1 14rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
.folder-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.folder-row > :first-child {
  flex: 1;
}
.actions,
.saved {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
</style>
