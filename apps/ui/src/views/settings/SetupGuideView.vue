<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSetupGuide } from '@/composables/useSetupGuide'
import { useSetupStatus } from '@/composables/useSetupStatus'
import { useSetupStore } from '@/stores/setup'
import { useConnectionStore } from '@/stores/connection'
import { searchableText } from '@/setup/content'
import GuideBlocks from '@/components/setup/GuideBlocks.vue'
import SetupStatusChip from '@/components/setup/SetupStatusChip.vue'

const guide = useSetupGuide()
const setup = useSetupStore()
const connection = useConnectionStore()
const route = useRoute()
const router = useRouter()
const { statuses, refreshing, refresh } = useSetupStatus()
const query = ref('')
const sections = computed(() => {
  const q = (query.value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim()
  return guide.value?.sections.filter((section) => !q || searchableText(section).includes(q)) ?? []
})
function launch(reset = false): void { setup.start(reset); void router.push('/setup') }
async function focusTopic(): Promise<void> {
  await nextTick()
  const topic = typeof route.query.topic === 'string' ? route.query.topic : ''
  if (!guide.value?.sections.some((section) => section.id === topic)) return
  const heading = document.getElementById(`guide-${topic}`)
  heading?.scrollIntoView({ block: 'start' })
  heading?.focus({ preventScroll: true })
}
watch([guide, () => route.query.topic], () => void focusTopic(), { immediate: true, flush: 'post' })
function goTopic(id: string): void {
  query.value = ''
  void router.replace({ path: '/settings/setup', query: { topic: id } }).then(focusTopic)
}
</script>

<template>
  <section class="setup-guide" data-test="setup-guide">
    <h2 class="th-display">{{ $t('setup.guideTitle') }}</h2>
    <p class="lead">{{ guide?.intro }}</p>
    <div class="actions">
      <v-btn color="primary" data-test="setup-launch" @click="launch()">{{ $t(setup.resumable ? 'setup.resume' : setup.progress.state === 'completed' ? 'setup.reviewSetup' : 'setup.start') }}</v-btn>
      <v-btn v-if="setup.progress.state !== 'new'" variant="text" @click="launch(true)">{{ $t('setup.restart') }}</v-btn>
      <v-btn variant="tonal" :loading="refreshing" @click="refresh()">{{ $t('setup.refresh') }}</v-btn>
    </div>
    <v-alert v-if="!setup.storageAvailable" type="warning" variant="tonal">{{ $t('setup.storageWarning') }}</v-alert>
    <v-text-field v-model="query" :label="$t('setup.search')" clearable @click:clear="query = ''" />
    <nav :aria-label="$t('setup.contents')" class="contents">
      <a v-for="section in sections" :key="section.id" :href="`#guide-${section.id}`" @click.prevent="goTopic(section.id)">{{ section.title }}</a>
    </nav>
    <p v-if="guide && sections.length === 0" role="status">{{ $t('setup.noResults') }}</p>
    <p v-if="!guide" role="status">{{ $t('common.loading') }}</p>
    <article v-for="section in sections" :key="section.id" class="guide-section">
      <div class="section-heading">
        <h3 :id="`guide-${section.id}`" tabindex="-1" class="th-display">{{ section.title }}</h3>
        <SetupStatusChip v-if="statuses[section.id]" :status="statuses[section.id]!" />
        <span class="th-muted text-caption">{{ $t(section.optional ? 'setup.optional' : 'setup.baseline') }}</span>
      </div>
      <p>{{ section.summary }}</p>
      <v-btn v-if="section.route" variant="tonal" size="small" :to="section.route" :disabled="section.id !== 'service' && !connection.isConnected">{{ $t('setup.configure') }}</v-btn>
      <GuideBlocks :blocks="section.blocks" />
    </article>
  </section>
</template>

<style scoped>
.setup-guide { display: grid; gap: 20px; min-width: 0; }
.lead { max-width: 78ch; line-height: 1.7; }
.actions, .section-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.contents { display: grid; gap: 8px; padding: 16px; border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); }
.contents a { color: rgb(var(--v-theme-primary)); text-underline-offset: .2em; }
.guide-section { display: grid; gap: 16px; padding-top: 28px; border-top: 1px solid rgb(var(--v-theme-hairline)); min-width: 0; }
h2, h3, p { margin: 0; }
h3 { scroll-margin-top: 100px; font-size: 1.35rem; }
.guide-section > .v-btn { justify-self: start; }
</style>
