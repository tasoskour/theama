<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiArrowDown, mdiArrowUp, mdiClose } from '@mdi/js'
import { useConnectionStore } from '@/stores/connection'
import { usePlayersStore } from '@/stores/players'
import { useSettingsStore } from '@/stores/settings'

/** Languages offered for subtitles (ISO 639-1); the backend understands many spellings of each. */
const LANGUAGE_CODES = ['el', 'en', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'tr', 'ar', 'he', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'cs', 'hu', 'ro', 'bg', 'sr', 'hr', 'uk', 'ja', 'ko', 'zh', 'hi', 'th', 'id', 'vi', 'fa']

const { t, locale } = useI18n()
const players = usePlayersStore()
const settings = useSettingsStore()
const connection = useConnectionStore()
const snackbar = ref('')

const names = computed(() => {
  try {
    return new Intl.DisplayNames([locale.value], { type: 'language' })
  } catch {
    return null
  }
})
const nameOf = (code: string): string => names.value?.of(code) ?? code

const chosen = computed(() => settings.settings.subtitleLanguages)
const addable = computed(() => LANGUAGE_CODES.filter((c) => !chosen.value.includes(c)).map((c) => ({ value: c, title: nameOf(c) })))
const toAdd = ref<string | null>(null)

async function saveLanguages(next: string[]): Promise<void> {
  if (await settings.update({ subtitleLanguages: next })) snackbar.value = t('settings.general.saved')
}
const move = (i: number, by: -1 | 1): Promise<void> => {
  const next = [...chosen.value]
  const j = i + by
  if (j < 0 || j >= next.length) return Promise.resolve()
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  return saveLanguages(next)
}
const removeLanguage = (code: string): Promise<void> => saveLanguages(chosen.value.filter((c) => c !== code))
async function addLanguage(code: string | null): Promise<void> {
  if (!code) return
  toAdd.value = null
  await saveLanguages([...chosen.value, code].slice(0, 6))
}
</script>

<template>
  <section>
    <h2 class="th-display section-title">{{ $t('settings.sections.playback') }}</h2>
    <p class="intro">{{ $t('playback.intro') }}</p>

    <div class="field th-form-section">
      <span id="players-label" class="label">{{ $t('playback.players') }}</span>
      <v-alert v-if="!players.canPlay" type="info" variant="tonal" density="compact">{{ $t('play.needsAppHint') }}</v-alert>
      <template v-else>
        <v-radio-group
          :model-value="players.defaultPlayer?.id"
          aria-labelledby="players-label"
          hide-details
          @update:model-value="(v: string | null) => v && players.setDefault(v)"
        >
          <div v-for="p in players.players" :key="p.id" class="player" :class="{ 'player--missing': !p.available }" data-test="player-row">
            <v-radio :value="p.id" :disabled="!p.available" :label="p.name" />
            <span class="th-muted th-mono player__exe">{{ p.exe ?? $t('playback.systemHint') }}</span>
            <v-chip v-if="!p.available" size="x-small" label variant="outlined" color="warning">{{ $t('playback.notFound') }}</v-chip>
            <v-chip v-else-if="p.tracksPosition" size="x-small" label variant="tonal" color="success" :title="$t('playback.trackedHint')" data-test="tracks-position">{{ $t('playback.tracked') }}</v-chip>
            <v-chip v-if="p.available && !p.externalSubtitle && p.kind !== 'system'" size="x-small" label variant="outlined" :title="$t('playback.noSubtitleHint')">{{ $t('playback.noSubtitle') }}</v-chip>
            <v-btn v-if="p.removable" size="x-small" variant="text" color="error" @click="players.remove(p.id)">{{ $t('playback.remove') }}</v-btn>
          </div>
        </v-radio-group>
        <div class="row">
          <v-btn variant="tonal" data-test="add-player" @click="players.addCustom()">{{ $t('playback.addProgram') }}</v-btn>
          <v-btn variant="text" @click="players.load()">{{ $t('playback.rescan') }}</v-btn>
        </div>
        <p v-if="players.error" class="th-muted hint error">{{ players.error }}</p>
        <p class="th-muted hint">{{ $t('playback.playersHint') }}</p>
      </template>
    </div>

    <div class="field th-form-section">
      <span id="langs-label" class="label">{{ $t('playback.subtitleLanguages') }}</span>
      <ol class="langs" aria-labelledby="langs-label">
        <li v-for="(code, i) in chosen" :key="code" class="lang">
          <span class="lang__rank th-muted">{{ i + 1 }}</span>
          <span class="lang__name">{{ nameOf(code) }}</span>
          <v-btn icon size="x-small" variant="text" :disabled="i === 0 || !connection.isConnected" :aria-label="$t('playback.moveUp', { name: nameOf(code) })" @click="move(i, -1)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path :d="mdiArrowUp" fill="currentColor" /></svg>
          </v-btn>
          <v-btn icon size="x-small" variant="text" :disabled="i === chosen.length - 1 || !connection.isConnected" :aria-label="$t('playback.moveDown', { name: nameOf(code) })" @click="move(i, 1)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path :d="mdiArrowDown" fill="currentColor" /></svg>
          </v-btn>
          <v-btn icon size="x-small" variant="text" :disabled="!connection.isConnected" :aria-label="$t('playback.removeLanguage', { name: nameOf(code) })" @click="removeLanguage(code)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path :d="mdiClose" fill="currentColor" /></svg>
          </v-btn>
        </li>
      </ol>
      <p v-if="chosen.length === 0" class="th-muted hint">{{ $t('playback.noLanguages') }}</p>
      <v-select
        v-if="chosen.length < 6"
        v-model="toAdd"
        :items="addable"
        :label="$t('playback.addLanguage')"
        :disabled="!connection.isConnected"
        style="max-width: 280px"
        hide-details
        @update:model-value="addLanguage"
      />
      <p class="th-muted hint">{{ $t('playback.subtitleHint') }}</p>
    </div>

    <div class="field th-form-section">
      <span class="label">{{ $t('playback.tracking') }}</span>
      <p class="th-muted hint">{{ $t('playback.trackingText') }}</p>
    </div>

    <v-snackbar :model-value="snackbar !== ''" :timeout="2200" color="surface-bright" @update:model-value="snackbar = ''">{{ snackbar }}</v-snackbar>
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
  gap: 10px;
  margin-bottom: 32px;
}
.label {
  font-weight: 600;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  max-width: 62ch;
}
.error {
  color: rgb(var(--v-theme-error));
}
.player {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.player--missing {
  opacity: 0.7;
}
.player__exe {
  font-size: 0.78rem;
  word-break: break-all;
}
.row {
  display: flex;
  gap: 12px;
}
.langs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
  max-width: 420px;
}
.lang {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lang__rank {
  width: 1.5em;
  text-align: right;
}
.lang__name {
  flex: 1;
}
</style>
