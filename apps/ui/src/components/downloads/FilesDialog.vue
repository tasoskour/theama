<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DownloadFile, DownloadItem } from '@theama/contracts'
import { useDownloadsStore } from '@/stores/downloads'
import { formatBytes } from '@/utils/format'

const props = defineProps<{ item: DownloadItem | null }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [] }>()

const { locale } = useI18n()
const downloads = useDownloadsStore()

const files = ref<DownloadFile[]>([])
const chosen = ref(new Set<number>())
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
let generation = 0
let retry: ReturnType<typeof setTimeout> | undefined

const wantedCount = computed(() => chosen.value.size)
const wantedSize = computed(() => files.value.filter((f) => chosen.value.has(f.index)).reduce((sum, f) => sum + f.size, 0))
const fetching = computed(() => !loading.value && error.value === null && files.value.length === 0)

async function load(): Promise<void> {
  clearTimeout(retry)
  const hash = props.item?.hash
  if (!hash) return
  const mine = ++generation
  loading.value = true
  const res = await downloads.files(hash)
  if (mine !== generation) return
  loading.value = false
  if (!res.ok) {
    error.value = res.message
    return
  }
  error.value = null
  files.value = res.files
  chosen.value = new Set(res.files.filter((f) => f.wanted).map((f) => f.index))
  // A magnet link has no file list until qBittorrent has fetched its details: look again shortly.
  if (res.files.length === 0) retry = setTimeout(() => void load(), 3000)
}

watch(open, (isOpen) => {
  generation++
  clearTimeout(retry)
  if (!isOpen) return
  files.value = []
  chosen.value = new Set()
  error.value = null
  void load()
})
onScopeDispose(() => clearTimeout(retry))

function toggle(index: number, on: boolean | null): void {
  const next = new Set(chosen.value)
  if (on) next.add(index)
  else next.delete(index)
  chosen.value = next
}
const selectAll = () => (chosen.value = new Set(files.value.map((f) => f.index)))
const selectNone = () => (chosen.value = new Set())

async function save(): Promise<void> {
  const hash = props.item?.hash
  if (!hash || saving.value || chosen.value.size === 0) return
  saving.value = true
  error.value = null
  const res = await downloads.selectFiles(hash, [...chosen.value].sort((a, b) => a - b))
  saving.value = false
  if (res.ok) {
    open.value = false
    emit('saved')
  } else {
    error.value = res.message
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="760" scrollable aria-labelledby="files-title">
    <v-card>
      <v-card-title id="files-title" class="th-display">{{ $t('downloads.active.files.title') }}</v-card-title>
      <v-card-subtitle class="subtitle">{{ item?.name }}</v-card-subtitle>
      <v-card-text>
        <p class="th-muted intro">{{ $t('downloads.active.files.intro') }}</p>

        <p v-if="loading && files.length === 0" class="th-muted" aria-live="polite"><v-progress-circular indeterminate size="18" width="2" class="mr-2" />{{ $t('common.loading') }}</p>
        <p v-else-if="fetching" class="th-muted" aria-live="polite" data-test="files-fetching">
          <v-progress-circular indeterminate size="18" width="2" class="mr-2" />{{ $t('downloads.active.files.fetching') }}
        </p>
        <v-alert v-if="error" type="warning" variant="tonal" density="compact" class="mb-3" data-test="files-error">{{ error }}</v-alert>

        <template v-if="files.length > 0">
          <div class="bulk">
            <v-btn variant="text" size="small" @click="selectAll">{{ $t('downloads.active.files.selectAll') }}</v-btn>
            <v-btn variant="text" size="small" @click="selectNone">{{ $t('downloads.active.files.selectNone') }}</v-btn>
            <span class="th-muted summary" aria-live="polite">{{ $t('downloads.active.files.summary', { wanted: wantedCount, total: files.length, size: formatBytes(wantedSize, locale) }) }}</span>
          </div>
          <ul class="files" role="list" data-test="file-list">
            <li v-for="f in files" :key="f.index" class="file">
              <v-checkbox-btn :model-value="chosen.has(f.index)" :aria-label="f.name" density="compact" data-test="file-check" @update:model-value="(on: boolean | null) => toggle(f.index, on)" />
              <span class="file__name">{{ f.name }}</span>
              <span class="th-muted file__size">{{ formatBytes(f.size, locale) }}</span>
            </li>
          </ul>
          <p v-if="wantedCount === 0" class="th-muted need-one" data-test="files-need-one">{{ $t('downloads.active.files.needOne') }}</p>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="wantedCount === 0 || files.length === 0" data-test="files-save" @click="save">{{ $t('downloads.active.files.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.subtitle {
  overflow-wrap: anywhere;
  white-space: normal;
}
.intro {
  margin: 0 0 12px;
  font-size: 0.9rem;
}
.bulk {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}
.summary {
  margin-left: auto;
  font-size: 0.85rem;
}
.files {
  list-style: none;
  margin: 0;
  padding: 0;
}
.file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(var(--v-theme-hairline), 0.5);
}
.file__name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.9rem;
}
.file__size {
  flex: none;
  font-size: 0.82rem;
}
.need-one {
  margin: 8px 0 0;
  font-size: 0.85rem;
}
</style>
