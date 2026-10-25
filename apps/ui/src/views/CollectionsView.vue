<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { mdiFolderMultipleOutline, mdiPlus } from '@mdi/js'
import { CollectionList, type CollectionDetail, type CollectionKind, type CollectionSummary } from '@theama/contracts'
import CollectionCard from '@/components/collections/CollectionCard.vue'
import NewCollectionDialog from '@/components/collections/NewCollectionDialog.vue'
import { useLatestRequest, useRefresh } from '@/composables/useRefresh'
import { useConnectionStore } from '@/stores/connection'
import { useMetadataStore } from '@/stores/metadata'
import { moveBetweenCards } from '@/utils/gridNav'

const connection = useConnectionStore()
const metadata = useMetadataStore()
const router = useRouter()

const items = ref<CollectionSummary[]>([])
const loaded = ref(false)
const error = ref<string | null>(null)
const filter = ref<CollectionKind | 'all'>('all')
const creating = ref(false)

const latest = useLatestRequest()
const refresh = useRefresh(load)

async function load(): Promise<void> {
  const client = connection.client
  if (!client) return
  await latest(signal => client.get('/collections', CollectionList, undefined, { signal }), result => {
    items.value = result.items
    error.value = null
    loaded.value = true
  }, err => { error.value = err instanceof Error ? err.message : String(err) })
}

watch(() => connection.phase, (p) => p === 'connected' && void load(), { immediate: true })
onScopeDispose(
  connection.onEvent((e) => {
    if (e.type === 'library.changed') refresh.schedule()
  }),
)

const shown = computed(() => (filter.value === 'all' ? items.value : items.value.filter((c) => c.kind === filter.value)))
const FILTERS: (CollectionKind | 'all')[] = ['all', 'official', 'user']

function created(detail: CollectionDetail): void {
  void router.push({ name: 'collection', query: { id: detail.summary.id } })
}
</script>

<template>
  <div class="th-page th-page--wide">
    <header class="head th-page-header">
      <div>
        <p class="th-eyebrow mb-2">{{ $t('app.tagline') }}</p>
        <h1 class="th-display th-page-title">{{ $t('nav.collections') }}</h1>
      </div>
      <v-btn color="primary" variant="flat" :prepend-icon="mdiPlus" :disabled="!connection.isConnected" data-test="new-collection-page" @click="creating = true">
        {{ $t('collections.newCollection') }}
      </v-btn>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <div v-if="items.length > 0" class="toolbar">
      <v-btn-toggle v-model="filter" mandatory divided density="comfortable" color="primary" variant="outlined" class="wrap-toggle" :aria-label="$t('collections.filter')">
        <v-btn v-for="f in FILTERS" :key="f" :value="f" :aria-pressed="filter === f">{{ $t(`collections.filters.${f}`) }}</v-btn>
      </v-btn-toggle>
    </div>

    <ul v-if="shown.length > 0" class="grid" role="list" :aria-label="$t('nav.collections')" @keydown="moveBetweenCards($event, '[data-collection-id]')">
      <li v-for="c in shown" :key="c.id"><CollectionCard :collection="c" /></li>
    </ul>

    <section v-else-if="loaded" class="empty">
      <svg class="empty__icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiFolderMultipleOutline" fill="currentColor" /></svg>
      <h2 class="th-display">{{ $t(items.length > 0 ? 'collections.noneOfKind' : 'empty.collections.title') }}</h2>
      <p class="th-muted">{{ $t(items.length > 0 ? 'collections.noneOfKindHint' : 'collections.emptyBody') }}</p>
      <p v-if="items.length === 0 && metadata.status && !metadata.status.configured" class="th-muted">
        {{ $t('collections.needsKey') }} <router-link to="/settings/metadata">{{ $t('match.openSettings') }}</router-link>
      </p>
    </section>

    <NewCollectionDialog v-model="creating" @created="created" />
  </div>
</template>

<style scoped>
.head {
  gap: 16px;
}
.toolbar {
  margin-bottom: 24px;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--th-poster-min), 1fr));
  gap: var(--th-poster-gap);
}
.empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 4.5rem 1rem;
  text-align: center;
  max-width: 35rem;
  margin: 0 auto;
}
/* The icon is 2.5em of the surrounding text so it follows the text size. */
.empty__icon {
  width: 2.5rem;
  height: 2.5rem;
}
.empty h2 {
  font-size: 1.5rem;
  margin: 8px 0 0;
}
.empty p {
  margin: 0;
}
/* A toggle with several long labels wraps instead of scrolling sideways. */
.wrap-toggle.v-btn-toggle {
  height: auto !important;
  max-width: 100%;
  flex-wrap: wrap;
}
</style>
