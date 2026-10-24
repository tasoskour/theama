<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MetadataLanguage } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'
import { useMetadataStore } from '@/stores/metadata'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const connection = useConnectionStore()
const metadata = useMetadataStore()
const settings = useSettingsStore()

const key = ref('')
const saving = ref(false)
const problem = ref<string | null>(null)
const replacing = ref(false)
const snackbar = ref('')

const status = computed(() => metadata.status)
const configured = computed(() => status.value?.configured === true)
const showField = computed(() => !configured.value || replacing.value)

const languages: { value: MetadataLanguage; title: string }[] = [
  { value: 'en', title: 'English' },
  { value: 'el', title: 'Ελληνικά' },
]

const stateText = computed(() => {
  const s = status.value
  if (!s) return ''
  return t(`metadata.state.${s.state}`)
})
const stateColor = computed(() => {
  switch (status.value?.state) {
    case 'working':
    case 'idle':
      return 'success'
    case 'unavailable':
    case 'invalid_key':
      return 'warning'
    default:
      return undefined
  }
})

async function saveKey(): Promise<void> {
  const value = key.value.trim()
  if (!value || saving.value) return
  saving.value = true
  problem.value = null
  const res = await metadata.saveKey(value)
  saving.value = false
  if (res.ok) {
    key.value = ''
    replacing.value = false
    snackbar.value = t('metadata.saved')
  } else {
    problem.value = res.code === 'invalid_key' ? t('metadata.keyRejected') : res.message
  }
}

async function removeKey(): Promise<void> {
  saving.value = true
  const res = await metadata.saveKey(null)
  saving.value = false
  if (res.ok) {
    replacing.value = false
    snackbar.value = t('metadata.removed')
  } else problem.value = res.message
}

async function setLanguage(value: MetadataLanguage): Promise<void> {
  if (await settings.update({ metadataLanguage: value })) snackbar.value = t('settings.general.saved')
}
</script>

<template>
  <section>
    <h2 class="th-display section-title">{{ $t('settings.sections.metadata') }}</h2>
    <p class="intro">{{ $t('metadata.intro') }}</p>

    <div class="field th-form-section">
      <div class="label-row">
        <span id="tmdb-label" class="label">{{ $t('metadata.tmdb') }}</span>
        <v-chip v-if="status" size="small" label variant="tonal" :color="stateColor" data-test="metadata-state">{{ stateText }}</v-chip>
      </div>

      <template v-if="showField">
        <form class="key-row" @submit.prevent="saveKey">
          <v-text-field
            v-model="key"
            type="password"
            autocomplete="off"
            spellcheck="false"
            :label="$t('metadata.keyLabel')"
            :hint="$t('metadata.keyHint')"
            persistent-hint
            :error-messages="problem ?? undefined"
            :disabled="!connection.isConnected"
            aria-describedby="tmdb-label"
            data-test="tmdb-key"
          />
          <v-btn type="submit" color="primary" :loading="saving" :disabled="!key.trim() || !connection.isConnected" data-test="tmdb-save">{{ $t('common.save') }}</v-btn>
          <v-btn v-if="replacing" variant="text" @click="((replacing = false), (key = ''), (problem = null))">{{ $t('common.cancel') }}</v-btn>
        </form>
        <p class="th-muted hint">{{ $t('metadata.howToGet') }}</p>
      </template>
      <div v-else class="key-saved">
        <span>{{ $t('metadata.keySaved') }}</span>
        <v-btn variant="tonal" size="small" @click="replacing = true">{{ $t('metadata.replace') }}</v-btn>
        <v-btn variant="text" size="small" color="error" :loading="saving" @click="removeKey">{{ $t('metadata.remove') }}</v-btn>
      </div>

      <v-alert v-if="status?.state === 'unavailable'" type="warning" variant="tonal" density="compact" class="mt-4">
        {{ $t('metadata.unavailable') }}
        <span v-if="status.message" class="th-muted"> ({{ status.message }})</span>
        <template #append><v-btn variant="text" size="small" @click="metadata.retry()">{{ $t('metadata.retry') }}</v-btn></template>
      </v-alert>
      <v-alert v-if="status?.state === 'invalid_key'" type="warning" variant="tonal" density="compact" class="mt-4">{{ $t('metadata.rejected') }}</v-alert>
    </div>

    <div v-if="configured && status" class="field th-form-section">
      <span class="label">{{ $t('metadata.progress') }}</span>
      <p v-if="status.state === 'working' && status.current" class="th-muted hint" aria-live="polite">{{ $t('metadata.lookingUp', { title: status.current }) }}</p>
      <dl class="counts" data-test="metadata-counts">
        <div><dt>{{ $t('metadata.counts.matched') }}</dt><dd>{{ status.matched }}</dd></div>
        <div><dt>{{ $t('metadata.counts.ambiguous') }}</dt><dd>{{ status.ambiguous }}</dd></div>
        <div><dt>{{ $t('metadata.counts.unmatched') }}</dt><dd>{{ status.unmatched }}</dd></div>
        <div><dt>{{ $t('metadata.counts.pending') }}</dt><dd>{{ status.pending }}</dd></div>
      </dl>
      <p class="th-muted hint">{{ $t('metadata.countsHint') }}</p>
    </div>

    <div class="field th-form-section">
      <label class="label" for="meta-lang">{{ $t('metadata.language') }}</label>
      <v-select
        id="meta-lang"
        :model-value="settings.settings.metadataLanguage"
        :items="languages"
        :disabled="!connection.isConnected"
        style="min-width: 10rem; max-width: min(100%, 14rem)"
        @update:model-value="setLanguage"
      />
      <p class="th-muted hint">{{ $t('metadata.languageHint') }}</p>
    </div>

    <div class="field th-form-section">
      <span class="label">{{ $t('metadata.privacy') }}</span>
      <p class="th-muted hint">{{ $t('metadata.privacyText') }}</p>
    </div>

    <p class="th-muted attribution">{{ $t('match.attribution') }}</p>
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
.key-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: flex-start;
  max-width: 40rem;
}
.key-row :deep(.v-input) {
  flex: 1 1 14rem;
  min-width: 0;
}
.key-saved {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.counts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 32px;
  margin: 0;
}
.counts div {
  display: grid;
}
.counts dt {
  font-size: 0.8rem;
  opacity: 0.75;
}
.counts dd {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}
.attribution {
  font-size: 0.78rem;
  max-width: 62ch;
}
</style>
