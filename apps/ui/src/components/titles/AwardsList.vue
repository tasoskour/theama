<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { mdiTrophyOutline } from '@mdi/js'
import type { Award, AwardsSubject } from '@theama/contracts'
import { useMetadataStore } from '@/stores/metadata'
import { useLatestRequest } from '@/composables/useRefresh'

const PREVIEW = 6

const props = defineProps<{
  subject: AwardsSubject
  externalId: string
  /** Render nothing unless there is something to show (the title page); a popover says so instead. */
  hideWhenEmpty?: boolean
  headingLevel?: 'h2' | 'h3'
}>()
const metadata = useMetadataStore()
const latest = useLatestRequest()
const loading = ref(false)
const failed = ref(false)
const wins = ref(0)
const nominations = ref(0)
const items = ref<Award[]>([])
const expanded = ref(false)
const shown = computed(() => (expanded.value ? items.value : items.value.slice(0, PREVIEW)))
const empty = computed(() => items.value.length === 0)
const visible = computed(() => !props.hideWhenEmpty || (!loading.value && !failed.value && !empty.value))

async function load(): Promise<void> {
  loading.value = true
  failed.value = false
  await latest(signal => metadata.awards(props.subject, props.externalId, signal), (res) => {
    loading.value = false
    if (res.ok) {
      wins.value = res.wins
      nominations.value = res.nominations
      items.value = res.items
    } else failed.value = true
  }, () => {
    loading.value = false
    failed.value = true
  })
}

watch(() => [props.subject, props.externalId] as const, () => {
  latest.cancel()
  wins.value = 0
  nominations.value = 0
  items.value = []
  expanded.value = false
  void load()
}, { immediate: true })
</script>

<template>
  <section v-if="visible" class="awards" :class="{ 'awards--page': headingLevel === 'h2' }" :aria-label="$t('detail.awards.title')" data-test="awards">
    <component :is="headingLevel ?? 'h3'" :class="headingLevel === 'h2' ? 'th-display files__title' : 'awards__heading'">{{ $t('detail.awards.title') }}</component>
    <p v-if="loading" class="th-muted awards__note" role="status" data-test="awards-loading">
      <v-progress-circular indeterminate size="16" width="2" class="mr-2" />{{ $t('detail.awards.loading') }}
    </p>
    <p v-else-if="failed" class="th-muted awards__note" data-test="awards-error">
      {{ $t('detail.awards.unavailable') }}
      <v-btn variant="text" size="small" data-test="awards-retry" @click="load">{{ $t('common.retry') }}</v-btn>
    </p>
    <p v-else-if="empty" class="th-muted awards__note" data-test="awards-empty">{{ $t('detail.awards.none') }}</p>
    <template v-else>
      <div class="awards__counts">
        <v-chip v-if="wins" size="small" color="primary" variant="tonal" :prepend-icon="mdiTrophyOutline" data-test="awards-wins">{{ $t('detail.awards.wins', wins) }}</v-chip>
        <v-chip v-if="nominations" size="small" variant="tonal" data-test="awards-nominations">{{ $t('detail.awards.nominations', nominations) }}</v-chip>
      </div>
      <ul class="awards__list" role="list">
        <li v-for="(award, index) in shown" :key="index" class="awards__item" data-test="award">
          <span class="awards__name">{{ award.name }}</span>
          <span class="th-muted awards__meta">
            {{ $t(award.result === 'won' ? 'detail.awards.won' : 'detail.awards.nominated') }}<template v-if="award.year"> · {{ award.year }}</template><template v-if="award.forWork"> · {{ $t('detail.awards.forWork', { work: award.forWork }) }}</template>
          </span>
        </li>
      </ul>
      <v-btn v-if="items.length > PREVIEW" variant="text" size="small" data-test="awards-toggle" @click="expanded = !expanded">
        {{ expanded ? $t('detail.awards.showLess') : $t('detail.awards.showAll', { count: items.length }) }}
      </v-btn>
      <p class="th-muted awards__source">{{ $t('detail.awards.source') }}</p>
    </template>
  </section>
</template>

<style scoped>
.awards {
  min-width: 0;
}
.awards--page {
  margin-top: 32px;
}
.awards--page .awards__counts,
.awards--page .awards__list,
.awards--page .awards__source {
  padding-inline: 0;
}
.awards__heading {
  padding: 16px 16px 0;
  font-size: 0.9rem;
}
.awards__note {
  margin: 0;
  padding: 12px 16px;
  line-height: 1.45;
}
.awards__counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px 0;
}
.awards__list {
  list-style: none;
  margin: 0;
  padding: 8px 16px;
  display: grid;
  gap: 8px;
}
.awards__item {
  display: grid;
  min-width: 0;
  overflow-wrap: anywhere;
}
.awards__name {
  font-weight: 600;
}
.awards__meta {
  font-size: 0.85rem;
}
.awards__source {
  margin: 0;
  padding: 0 16px 12px;
  font-size: 0.75rem;
}
</style>
