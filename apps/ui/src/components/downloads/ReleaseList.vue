<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiArrowLeft } from '@mdi/js'
import type { Release, ReleaseKind, ReleaseSource, Resolution } from '@theama/contracts'
import { useDownloadsStore } from '@/stores/downloads'
import { formatBytes } from '@/utils/format'

const props = defineProps<{ query: { kind: ReleaseKind; title: string; year?: number | undefined; season?: number | undefined; episode?: number | undefined } }>()
defineEmits<{ back: [] }>()

const { t, locale } = useI18n()
const downloads = useDownloadsStore()

const loading = ref(false)
const error = ref<{ code: string; message: string } | null>(null)
const source = ref<ReleaseSource | null>(null)
const items = ref<Release[]>([])
const received = ref(0)
const resolution = ref<Resolution | null>(null)
const adding = ref<string | null>(null)
const sent = ref(new Set<string>())
const snackbar = ref('')
let generation = 0

const resolutions = computed(() => (['2160p', '1080p', '720p', '480p'] as const).filter((r) => items.value.some((i) => i.resolution === r)))
const shown = computed(() => (resolution.value ? items.value.filter((i) => i.resolution === resolution.value) : items.value))

async function run(): Promise<void> {
  const mine = ++generation
  loading.value = true
  error.value = null
  items.value = []
  resolution.value = null
  const res = await downloads.findReleases(props.query)
  if (mine !== generation) return
  loading.value = false
  if (res.ok) {
    items.value = res.value.items
    source.value = res.value.source
    received.value = res.value.received
  } else {
    error.value = { code: res.code, message: res.message }
  }
}

// A new query (another title picked) starts a new search; the list lives only as long as it is on screen.
watch(
  () => props.query,
  () => {
    sent.value = new Set()
    void run()
  },
  { immediate: true },
)

async function add(r: Release): Promise<void> {
  if (adding.value) return
  adding.value = r.id
  const res = await downloads.download(r.id, props.query.kind)
  adding.value = null
  if (res.ok) {
    sent.value = new Set([...sent.value, r.id])
    snackbar.value = t('downloads.releases.sent')
  } else if (res.code === 'release_expired') {
    error.value = { code: res.code, message: t('downloads.releases.expired') }
  } else {
    error.value = { code: res.code, message: res.message }
  }
}

function facts(r: Release): string[] {
  const out: string[] = []
  if (r.resolution) out.push(r.resolution)
  if (r.quality) out.push(r.quality)
  if (r.codec) out.push(r.codec)
  out.push(r.size > 0 ? formatBytes(r.size, locale.value) : t('downloads.releases.unknownSize'))
  if (r.pack) out.push(t('downloads.releases.pack'))
  return out
}

const heading = computed(() => {
  const q = props.query
  const bits = [q.title]
  if (q.kind === 'movie' && q.year) bits.push(`(${q.year})`)
  if (q.kind === 'series' && q.season !== undefined) bits.push(`S${String(q.season).padStart(2, '0')}${q.episode !== undefined ? `E${String(q.episode).padStart(2, '0')}` : ''}`)
  return bits.join(' ')
})
</script>

<template>
  <section class="rel" :aria-label="heading">
    <div class="rel__head">
      <v-btn :icon="mdiArrowLeft" variant="text" size="small" :aria-label="$t('downloads.releases.back')" data-test="releases-back" @click="$emit('back')" />
      <h2 class="th-display rel__title">{{ heading }}</h2>
      <v-progress-circular v-if="loading" indeterminate size="1.15em" width="2" :aria-label="$t('downloads.releases.searching')" />
      <v-chip-group v-if="resolutions.length > 1" v-model="resolution" column class="rel__chips" :aria-label="$t('detail.facts.resolution')">
        <v-chip v-for="r in resolutions" :key="r" :value="r" filter variant="tonal" size="small">{{ r }}</v-chip>
      </v-chip-group>
    </div>

    <v-alert v-if="error" type="warning" variant="tonal" density="compact" class="mb-3" data-test="release-error">
      {{ error.message }}
      <template v-if="error.code === 'not_configured'">
        <router-link to="/settings/downloads">{{ $t('downloads.find.openSettings') }}</router-link>
      </template>
      <template #append><v-btn variant="text" size="small" @click="run">{{ $t('common.retry') }}</v-btn></template>
    </v-alert>

    <p v-if="!loading && !error && items.length === 0" class="th-muted" data-test="release-none">{{ $t(received === 0 ? 'downloads.releases.nothingReceived' : 'downloads.releases.noneMatched', { count: received, source: source ? $t(`downloads.releases.name.${source}`) : '' }) }}</p>

    <ul v-if="shown.length > 0" class="releases" role="list" data-test="release-list">
      <li v-for="r in shown" :key="r.id" class="release">
        <div class="release__main">
          <span class="release__title">{{ r.title }}</span>
          <span class="release__facts th-muted">
            {{ facts(r).join(' · ') }}<template v-if="r.indexer"> · {{ r.indexer }}</template>
          </span>
        </div>
        <span class="release__seeders th-muted">{{ $t('downloads.releases.seeders', r.seeders) }}</span>
        <v-btn
          :color="sent.has(r.id) ? 'success' : 'primary'"
          :variant="sent.has(r.id) ? 'tonal' : 'flat'"
          size="small"
          :loading="adding === r.id"
          :disabled="adding !== null || sent.has(r.id)"
          data-test="release-download"
          @click="add(r)"
        >{{ sent.has(r.id) ? $t('downloads.releases.sent') : $t('downloads.releases.download') }}</v-btn>
      </li>
    </ul>

    <v-snackbar :model-value="snackbar !== ''" :timeout="2400" color="surface-bright" @update:model-value="snackbar = ''">{{ snackbar }}</v-snackbar>
  </section>
</template>

<style scoped>
.rel__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-bottom: 4px;
}
.rel__title {
  font-size: 1.15rem;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.rel__chips {
  margin-left: auto;
}
.releases {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.release {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-theme-hairline), 0.72);
}
.release__main {
  display: grid;
  min-width: 0;
}
.release__title {
  overflow-wrap: anywhere;
  font-weight: 500;
}
.release__facts,
.release__seeders {
  font-size: 0.82rem;
}
@media (max-width: 40rem) {
  .release {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .release__seeders {
    grid-column: 1;
  }
}
</style>
