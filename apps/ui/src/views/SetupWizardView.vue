<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { UiLanguage } from '@theama/contracts'
import { SUPPORTED_LANGUAGES, setLanguage, writeCachedPrefs } from '@/i18n'
import { useSetupGuide } from '@/composables/useSetupGuide'
import { useSetupStatus } from '@/composables/useSetupStatus'
import { useSetupStore } from '@/stores/setup'
import { useConnectionStore } from '@/stores/connection'
import { useSettingsStore } from '@/stores/settings'
import { useServiceStore } from '@/stores/service'
import { WIZARD_STEPS, type WizardStep } from '@/setup/content'
import GuideBlocks from '@/components/setup/GuideBlocks.vue'
import SetupStatusChip from '@/components/setup/SetupStatusChip.vue'

const FORMS = {
  service: defineAsyncComponent(() => import('@/views/settings/ServiceSettings.vue')),
  library: defineAsyncComponent(() => import('@/views/settings/LibrarySettings.vue')),
  playback: defineAsyncComponent(() => import('@/views/settings/PlaybackSettings.vue')),
  metadata: defineAsyncComponent(() => import('@/views/settings/MetadataSettings.vue')),
  subtitles: defineAsyncComponent(() => import('@/views/settings/PlaybackSettings.vue')),
  downloads: defineAsyncComponent(() => import('@/views/settings/DownloadsSettings.vue')),
}
const setup = useSetupStore()
const connection = useConnectionStore()
const settings = useSettingsStore()
const service = useServiceStore()
const router = useRouter()
const { locale, t } = useI18n()
const guide = useSetupGuide()
const { statuses, refresh } = useSetupStatus()
const step = computed(() => setup.progress.step)
const index = computed(() => WIZARD_STEPS.indexOf(step.value))
const section = computed(() => guide.value?.sections.find((s) => s.id === step.value))
const reviewItems = computed(() => [
  ...WIZARD_STEPS.filter((s) => s !== 'welcome' && s !== 'review').map((id) => ({ id, title: t(`setup.steps.${id}`), step: id as WizardStep })),
  { id: 'prowlarr' as const, title: guide.value?.sections.find((s) => s.id === 'prowlarr')?.title ?? 'Prowlarr', step: 'downloads' as WizardStep },
])
const related = computed(() => step.value === 'downloads' ? guide.value?.sections.filter((s) => s.id === 'prowlarr' || s.id === 'vpn') ?? [] : [])
const formComponent = computed(() => step.value in FORMS ? FORMS[step.value as keyof typeof FORMS] : null)
const form = ref<{ saveForSetup?: () => Promise<boolean> } | null>(null)
const heading = ref<HTMLElement | null>(null)
const busy = ref(false)
const failed = ref(false)
const waiting = computed(() => busy.value || settings.saving || service.busy !== null)
const needsBackend = computed(() => !['welcome', 'service', 'review'].includes(step.value))

onMounted(() => { setup.start() })
watch(step, async () => {
  failed.value = false
  await nextTick()
  heading.value?.focus()
  heading.value?.scrollIntoView({ block: 'start' })
})
async function chooseLanguage(value: string): Promise<void> {
  const language: UiLanguage = value === 'el' ? 'el' : 'en'
  setup.chooseLanguage(language)
  setLanguage(language)
  writeCachedPrefs({ language })
  if (connection.isConnected) await settings.update({ language })
}
watch(() => [connection.phase, settings.loaded] as const, async ([phase, loaded]) => {
  const language = setup.progress.language
  if (phase === 'connected' && loaded && language && settings.settings.language !== language) await settings.update({ language })
}, { immediate: true })

async function advance(skip = false): Promise<void> {
  if (waiting.value) return
  busy.value = true
  failed.value = false
  try {
    if (!skip && (await form.value?.saveForSetup?.()) === false) { failed.value = true; return }
    if (step.value === 'review') {
      setup.complete()
      await router.push('/')
    } else {
      setup.advance(skip)
      void refresh()
    }
  } catch { failed.value = true }
  finally { busy.value = false }
}
function later(): void { setup.dismiss(); void router.push('/') }
function reviewStep(id: WizardStep): void { setup.jump(id) }
</script>

<template>
  <div class="th-page wizard" data-test="setup-wizard">
    <header class="wizard-header">
      <div>
        <p class="th-muted">{{ $t('setup.stepCount', { current: index + 1, total: WIZARD_STEPS.length }) }}</p>
        <h1 ref="heading" tabindex="-1" class="th-display">{{ $t(`setup.steps.${step}`) }}</h1>
      </div>
      <v-btn variant="text" :to="{ path: '/settings/setup', query: { topic: step } }">{{ $t('setup.guideTitle') }}</v-btn>
    </header>
    <v-progress-linear :model-value="((index + 1) / WIZARD_STEPS.length) * 100" :aria-label="$t('setup.progress')" rounded />
    <nav :aria-label="$t('setup.progress')" class="step-list">
      <span v-for="(item, i) in WIZARD_STEPS" :key="item" :aria-current="item === step ? 'step' : undefined" :class="{ current: item === step }">{{ i + 1 }}. {{ $t(`setup.steps.${item}`) }}</span>
    </nav>
    <v-alert v-if="!setup.storageAvailable" type="warning" variant="tonal">{{ $t('setup.storageWarning') }}</v-alert>
    <p v-if="section" class="summary">{{ section.summary }}</p>
    <SetupStatusChip v-if="statuses[step]" :status="statuses[step]!" />
    <p v-if="step !== 'welcome' && step !== 'review'" class="th-muted">{{ $t(section?.optional ? 'setup.optionalHint' : 'setup.baselineHint') }}</p>
    <div v-if="step === 'welcome'" class="language">
      <label for="setup-language">{{ $t('settings.general.language') }}</label>
      <v-select id="setup-language" :model-value="locale" :items="SUPPORTED_LANGUAGES.map((l) => ({ title: l.label, value: l.code }))" :disabled="settings.saving" @update:model-value="chooseLanguage" />
      <p>{{ $t('setup.saveHint') }}</p>
    </div>
    <GuideBlocks v-if="section" :blocks="section.blocks.filter((block) => block.kind === 'links')" />
    <details v-if="section" :key="step" class="instructions">
      <summary>{{ $t('setup.instructions') }}</summary>
      <GuideBlocks :blocks="section.blocks.filter((block) => block.kind !== 'links')" />
    </details>
    <v-alert v-if="needsBackend && !connection.isConnected" type="info" variant="tonal">
      {{ $t('setup.backendRequired') }}
      <v-btn variant="text" @click="setup.jump('service')">{{ $t('setup.steps.service') }}</v-btn>
    </v-alert>
    <fieldset v-if="formComponent" :disabled="needsBackend && !connection.isConnected" :inert="needsBackend && !connection.isConnected" class="setup-form">
      <legend class="th-muted">{{ $t('setup.configure') }}</legend>
      <component :is="formComponent" :key="step" ref="form" :setup-section="step === 'subtitles' ? 'subtitles' : 'players'" />
    </fieldset>
    <details v-for="item in related" :key="item.id" class="instructions related">
      <summary>{{ item.title }}</summary>
      <p>{{ item.summary }}</p>
      <GuideBlocks :blocks="item.blocks" />
    </details>
    <div v-if="step === 'review'" class="review-list" data-test="setup-review">
      <p>{{ $t('setup.incompleteHint') }}</p>
      <div v-for="item in reviewItems" :key="item.id" class="review-row">
        <span>{{ item.title }}</span>
        <SetupStatusChip :status="statuses[item.id] ?? 'unavailable'" />
        <v-btn variant="text" size="small" @click="reviewStep(item.step)">{{ $t('setup.revisit') }}</v-btn>
      </div>
    </div>
    <v-alert v-if="failed" type="error" variant="tonal" role="alert" data-test="setup-save-error">{{ $t('setup.saveError') }}</v-alert>
    <footer class="wizard-actions">
      <v-btn variant="tonal" :disabled="index === 0 || waiting" @click="setup.back()">{{ $t('setup.back') }}</v-btn>
      <v-btn color="primary" :loading="busy" :disabled="waiting || (needsBackend && !connection.isConnected)" data-test="setup-next" @click="advance()">{{ $t(step === 'review' ? 'setup.finish' : 'setup.saveContinue') }}</v-btn>
      <v-btn v-if="step !== 'welcome' && step !== 'review'" variant="text" :disabled="waiting" data-test="setup-skip" @click="advance(true)">{{ $t('setup.skip') }}</v-btn>
      <v-btn variant="text" :disabled="waiting" data-test="setup-later" @click="later()">{{ $t('setup.later') }}</v-btn>
    </footer>
  </div>
</template>

<style scoped>
.wizard { max-width: 1000px; margin: 0 auto; display: grid; gap: 24px; }
.wizard-header, .wizard-actions, .review-row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.wizard-header { justify-content: space-between; }
h1 { font-size: clamp(1.6rem, 3vw, 2.4rem); scroll-margin-top: 100px; }
h1, h2, p { margin: 0; }
.step-list { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: .85rem; color: rgb(var(--v-theme-on-surface-variant)); }
.current { color: rgb(var(--v-theme-primary)); font-weight: 700; }
.summary { max-width: 78ch; line-height: 1.7; }
.language { display: grid; gap: 12px; }
.language .v-input { max-width: 24rem; }
.setup-form { min-width: 0; border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); padding: 20px; }
.setup-form:disabled { opacity: .65; }
.setup-form legend { padding: 0 8px; }
.review-list { display: grid; gap: 16px; }
.related > p { margin-bottom: 16px; }
.instructions { border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); padding: 16px; }
.instructions summary { cursor: pointer; font-weight: 600; }
.instructions[open] > summary { margin-bottom: 16px; }
.review-row { padding: 12px 0; border-bottom: 1px solid rgb(var(--v-theme-hairline)); }
.review-row > span:first-child { flex: 1; min-width: 8rem; }
.wizard-actions { padding-top: 20px; border-top: 1px solid rgb(var(--v-theme-hairline)); }
</style>
