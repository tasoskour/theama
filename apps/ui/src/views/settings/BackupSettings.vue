<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
import { BackupInfo, BackupList } from '@theama/contracts'
import { getBridge } from '@/api/bridge'
import { ApiRequestError } from '@/api/client'
import { useConnectionStore } from '@/stores/connection'
import { useServiceStore } from '@/stores/service'
import { formatBytes } from '@/utils/format'

const { t, d, locale } = useI18n()
const connection = useConnectionStore()
const service = useServiceStore()
const bridge = getBridge()

const list = ref<BackupList | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const snackbar = ref('')
/** What the person is about to restore, awaiting confirmation. */
const confirming = ref<{ name: string } | { path: string; label: string } | null>(null)
const deleting = ref<BackupInfo | null>(null)

async function load(): Promise<void> {
  if (!connection.client) return
  try {
    list.value = await connection.client.get('/backups', BackupList)
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
watch(() => connection.phase, (p) => p === 'connected' && void load(), { immediate: true })
onScopeDispose(
  connection.onEvent((e) => {
    if (e.type === 'library.changed') void load()
  }),
)

function failure(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message
  return err instanceof Error ? err.message : String(err)
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await action()
  } catch (err) {
    error.value = failure(err)
  } finally {
    busy.value = false
  }
}

const backUpNow = (): Promise<void> =>
  run(async () => {
    await connection.client!.post('/backups', {}, BackupInfo)
    await load()
    snackbar.value = t('backup.made')
  })

const remove = (b: BackupInfo): Promise<void> =>
  run(async () => {
    await connection.client!.delete(`/backups/${encodeURIComponent(b.name)}`, z.object({ deleted: z.boolean() }))
    deleting.value = null
    await load()
  })

async function chooseFile(): Promise<void> {
  const path = await bridge?.pickBackupFile()
  if (path) confirming.value = { path, label: path.slice(path.lastIndexOf('\\') + 1) }
}

const stage = (): Promise<void> =>
  run(async () => {
    const target = confirming.value
    if (!target) return
    list.value = await connection.client!.post('/backups/restore', 'name' in target ? { name: target.name } : { path: target.path }, BackupList)
    confirming.value = null
  })

const cancelPending = (): Promise<void> =>
  run(async () => {
    list.value = await connection.client!.delete('/backups/restore', BackupList)
  })

async function restartNow(): Promise<void> {
  await service.run('restart')
  // The service comes back with the restored library; this page reconnects on its own.
  snackbar.value = t('backup.restarted')
}

const kindLabel = (kind: BackupInfo['kind']): string => t(`backup.kinds.${kind}`)
const openFolder = (): void => void bridge?.openPath(list.value!.directory)
</script>

<template>
  <section>
    <h3 class="th-display sub-title">{{ $t('backup.title') }}</h3>
    <p class="intro">{{ $t('backup.intro') }}</p>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4" data-test="backup-error">{{ error }}</v-alert>

    <v-alert v-if="list?.pending" type="warning" variant="tonal" class="mb-6" :title="$t('backup.pendingTitle')" data-test="restore-pending">
      {{ $t('backup.pendingBody', { source: list.pending.source, files: list.pending.summary.files, titles: list.pending.summary.titles }) }}
      <template #append>
        <div class="th-action-row">
          <v-btn v-if="service.supported" variant="flat" color="primary" :loading="service.busy === 'restart'" data-test="restart-now" @click="restartNow">{{ $t('backup.restartNow') }}</v-btn>
          <v-btn variant="text" :disabled="busy" @click="cancelPending">{{ $t('backup.cancelRestore') }}</v-btn>
        </div>
      </template>
      <p v-if="!service.supported" class="mt-2 mb-0">{{ $t('backup.restartByHand') }}</p>
    </v-alert>

    <div class="actions">
      <v-btn color="primary" variant="flat" :loading="busy" :disabled="!connection.isConnected" data-test="backup-now" @click="backUpNow">{{ $t('backup.now') }}</v-btn>
      <v-btn v-if="bridge" variant="tonal" :disabled="!connection.isConnected || busy" data-test="restore-file" @click="chooseFile">{{ $t('backup.fromFile') }}</v-btn>
      <v-btn v-if="bridge && list" variant="text" @click="openFolder">{{ $t('backup.openFolder') }}</v-btn>
    </div>

    <p v-if="list && list.items.length === 0" class="th-muted mt-6">{{ $t('backup.none') }}</p>
    <ul v-else-if="list" class="backups" role="list" :aria-label="$t('backup.title')" data-test="backup-list">
      <li v-for="b in list.items" :key="b.name" class="backup">
        <div class="backup__main">
          <span class="backup__when">{{ d(new Date(b.createdAt), 'short') }}</span>
          <v-chip size="x-small" label variant="tonal" :color="b.kind === 'manual' ? 'primary' : undefined">{{ kindLabel(b.kind) }}</v-chip>
          <span class="th-muted backup__meta">{{ formatBytes(b.size, locale) }}</span>
        </div>
        <v-btn size="small" variant="tonal" :disabled="busy" :aria-label="$t('backup.restoreFrom', { when: d(new Date(b.createdAt), 'short') })" data-test="restore-backup" @click="confirming = { name: b.name }">{{ $t('backup.restore') }}</v-btn>
        <v-btn size="small" variant="text" color="error" :disabled="busy" :aria-label="$t('backup.deleteOne', { when: d(new Date(b.createdAt), 'short') })" @click="deleting = b">{{ $t('backup.delete') }}</v-btn>
      </li>
    </ul>
    <p class="th-muted hint">{{ $t('backup.what') }}</p>

    <v-dialog :model-value="confirming !== null" max-width="32rem" aria-labelledby="restore-title" @update:model-value="(v: boolean) => !v && (confirming = null)">
      <v-card class="pa-2">
        <v-card-title id="restore-title" class="th-display">{{ $t('backup.confirmTitle') }}</v-card-title>
        <v-card-text>
          <p>{{ $t('backup.confirmBody') }}</p>
          <p class="th-muted">{{ $t('backup.confirmSafe') }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirming = null">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="busy" data-test="confirm-restore" @click="stage">{{ $t('backup.confirmGo') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="deleting !== null" max-width="29rem" aria-labelledby="delete-backup-title" @update:model-value="(v: boolean) => !v && (deleting = null)">
      <v-card class="pa-2">
        <v-card-title id="delete-backup-title" class="th-display">{{ $t('backup.deleteTitle') }}</v-card-title>
        <v-card-text>{{ $t('backup.deleteBody') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleting = null">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" :loading="busy" @click="deleting && remove(deleting)">{{ $t('backup.delete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar :model-value="snackbar !== ''" :timeout="2600" color="surface-bright" @update:model-value="snackbar = ''">{{ snackbar }}</v-snackbar>
  </section>
</template>

<style scoped>
.sub-title {
  font-size: 1.3rem;
  margin: 0 0 8px;
}
.intro {
  max-width: 64ch;
  margin: 0 0 20px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.backups {
  list-style: none;
  margin: 20px 0 0;
  padding: 0;
  display: grid;
  gap: 8px;
  max-width: 45rem;
}
.backup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid rgb(var(--v-theme-hairline));
  border-radius: var(--th-radius);
}
.backup__main {
  flex: 1 1 14rem;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.backup__when {
  min-width: 0;
}
.backup__meta {
  font-size: 0.85rem;
}
.hint {
  font-size: 0.85rem;
  max-width: 64ch;
  margin-top: 16px;
}
</style>
