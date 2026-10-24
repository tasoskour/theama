<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Release, ReleaseKind, ReleaseSource, Resolution } from '@theama/contracts'
import { useDownloadsStore } from '@/stores/downloads'
import { formatBytes } from '@/utils/format'

const props = defineProps<{ query: { kind: ReleaseKind; title: string; year?: number | undefined; season?: number | undefined; episode?: number | undefined } | null }>()
const open = defineModel<boolean>({ required: true })

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
  const q = props.query
  if (!q) return
  const mine = ++generation
  loading.value = true
  error.value = null
  items.value = []
  resolution.value = null
  const res = await downloads.findReleases(q)
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

watch(open, (isOpen) => {
  generation++
  if (!isOpen) return
  sent.value = new Set()
  void run()
})

async function add(r: Release): Promise<void> {
  if (!props.query || adding.value) return
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
  if (!q) return ''
  const bits = [q.title]
  if (q.kind === 'movie' && q.year) bits.push(`(${q.year})`)
  if (q.kind === 'series' && q.season !== undefined) bits.push(`S${String(q.season).padStart(2, '0')}${q.episode !== undefined ? `E${String(q.episode).padStart(2, '0')}` : ''}`)
  return bits.join(' ')
})
</script>

<template>
  <v-dialog v-model="open" max-width="900" scrollable aria-labelledby="releases-title">
    <v-card>
      <v-card-title id="releases-title" class="th-display">{{ $t('downloads.releases.title', { title: heading }) }}</v-card-title>
      <v-card-subtitle v-if="source && !loading && !error">{{ $t(`downloads.releases.source.${source}`) }}</v-card-subtitle>
      <v-card-text>
        <p v-if="loading" class="th-muted" aria-live="polite">
          <v-progress-circular indeterminate size="18" width="2" class="mr-2" />{{ $t('downloads.releases.searching') }}
        </p>

        <v-alert v-if="error" type="warning" variant="tonal" density="compact" class="mb-4" data-test="release-error">
          {{ error.message }}
          <template v-if="error.code === 'not_configured'">
            <router-link to="/settings/downloads" @click="open = false">{{ $t('downloads.find.openSettings') }}</router-link>
          </template>
          <template #append><v-btn variant="text" size="small" @click="run">{{ $t('common.retry') }}</v-btn></template>
        </v-alert>

        <v-chip-group v-if="resolutions.length > 1" v-model="resolution" class="mb-2" :aria-label="$t('detail.facts.resolution')">
          <v-chip v-for="r in resolutions" :key="r" :value="r" filter variant="tonal" size="small">{{ r }}</v-chip>
        </v-chip-group>

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
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('common.close') }}</v-btn>
      </v-card-actions>
    </v-card>
    <v-snackbar :model-value="snackbar !== ''" :timeout="2400" color="surface-bright" @update:model-value="snackbar = ''">{{ snackbar }}</v-snackbar>
  </v-dialog>
</template>

<style scoped>
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
  padding: 10px 0;
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
@media (max-width: 600px) {
  .release {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .release__seeders {
    grid-column: 1;
  }
}
</style>
