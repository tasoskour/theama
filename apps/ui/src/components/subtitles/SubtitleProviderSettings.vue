<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SubtitleProviderId } from '@theama/contracts'
import { openExternal } from '@/composables/useExternalLinks'
import { useConnectionStore } from '@/stores/connection'
import { useSubtitlesStore } from '@/stores/subtitles'
import { subtitleErrorKey, subtitleProviderName } from '@/utils/subtitles'

const { t } = useI18n()
const store = useSubtitlesStore()
const connection = useConnectionStore()
const keys = reactive({ opensubtitles: '', subdl: '' })
const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const configured = (id: string) => store.providers.find((p) => p.id === id)?.configured ?? false
const loggedIn = () => store.providers.find((p) => p.id === 'opensubtitles')?.loggedIn ?? false
async function run(action: () => Promise<void>, message: string | null = 'saved'): Promise<void> {
  busy.value = true
  error.value = ''
  notice.value = ''
  try { await action(); notice.value = message ? t(`subtitles.${message}`) : '' }
  catch (err) { error.value = t(subtitleErrorKey(err)) }
  finally { busy.value = false }
}
async function save(id: SubtitleProviderId): Promise<void> {
  await run(async () => { await store.setKey(id, keys[id].trim()); keys[id] = '' })
}
async function login(): Promise<void> {
  await run(async () => { await store.login(username.value.trim(), password.value); username.value = '' }, 'loggedIn')
  password.value = ''
}
function setup(id: SubtitleProviderId): void {
  void openExternal({ service: id }).catch(() => { error.value = t('subtitles.errors.generic') })
}
onMounted(() => run(() => store.load(), null))
</script>

<template>
  <div class="providers th-form-section">
    <h3 class="label">{{ $t('subtitles.providers') }}</h3>
    <p class="th-muted hint">{{ $t('subtitles.providersHint') }}</p>
    <div v-for="id in SubtitleProviderId.options" :key="id" class="provider" :data-test="`subtitle-provider-${id}`">
      <div class="row">
        <strong>{{ subtitleProviderName(id) }}</strong>
        <v-chip size="x-small" label :color="configured(id) ? 'success' : undefined">{{ $t(configured(id) ? 'subtitles.configured' : 'subtitles.notConfigured') }}</v-chip>
        <v-btn size="small" variant="text" @click="setup(id)">{{ $t('subtitles.getKey') }}</v-btn>
      </div>
      <form class="row" @submit.prevent="save(id)">
        <v-text-field v-model="keys[id]" :label="$t('subtitles.apiKey', { provider: subtitleProviderName(id) })" type="password" autocomplete="off" :disabled="busy || !connection.isConnected" hide-details />
        <v-btn type="submit" variant="tonal" :disabled="busy || !keys[id].trim() || !connection.isConnected">{{ $t(configured(id) ? 'subtitles.replaceKey' : 'common.save') }}</v-btn>
        <v-btn v-if="configured(id)" variant="text" :disabled="busy || !connection.isConnected" @click="run(() => store.test(id), 'testSuccess')">{{ $t('subtitles.test') }}</v-btn>
        <v-btn v-if="configured(id)" variant="text" color="error" :disabled="busy || !connection.isConnected" @click="run(() => store.setKey(id, null), 'removed')">{{ $t('subtitles.removeKey') }}</v-btn>
      </form>
      <template v-if="id === 'opensubtitles' && configured(id)">
        <p class="th-muted hint">{{ $t('subtitles.loginHint') }}</p>
        <div v-if="loggedIn()" class="row">
          <span>{{ $t('subtitles.loggedIn') }}</span>
          <v-btn size="small" variant="text" :disabled="busy || !connection.isConnected" @click="run(() => store.logout(), 'loggedOut')">{{ $t('subtitles.logout') }}</v-btn>
        </div>
        <form v-else class="row" @submit.prevent="login">
          <v-text-field v-model="username" :label="$t('subtitles.username')" autocomplete="username" :disabled="busy || !connection.isConnected" hide-details />
          <v-text-field v-model="password" :label="$t('subtitles.password')" type="password" autocomplete="current-password" :disabled="busy || !connection.isConnected" hide-details />
          <v-btn type="submit" variant="tonal" :disabled="busy || !username.trim() || !password || !connection.isConnected">{{ $t('subtitles.login') }}</v-btn>
        </form>
      </template>
    </div>
    <v-progress-linear v-if="busy" indeterminate :aria-label="$t('subtitles.working')" />
    <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
    <p v-if="notice" role="status">{{ notice }}</p>
  </div>
</template>

<style scoped>
.providers { display: grid; gap: 16px; margin-bottom: 32px; }
.label { font-size: 1rem; margin: 0; }
.hint { margin: 0; max-width: 65ch; font-size: .85rem; }
.provider { display: grid; gap: 12px; padding-block: 12px; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row :deep(.v-input) { flex: 1 1 14rem; }
</style>
