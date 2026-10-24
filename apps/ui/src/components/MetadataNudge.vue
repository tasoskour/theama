<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMetadataStore } from '@/stores/metadata'

const KEY = 'theama.metadataNudge.dismissed'
const metadata = useMetadataStore()

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
const dismissed = ref(wasDismissed())

/** Shown only once we know no key is set; a per-viewer convenience, so storage failures are ignored. */
const visible = computed(() => !dismissed.value && metadata.status !== null && !metadata.status.configured)

function dismiss(): void {
  dismissed.value = true
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // Not persisted; it simply returns next launch.
  }
}
</script>

<template>
  <v-alert v-if="visible" type="info" variant="tonal" density="comfortable" class="nudge" :title="$t('metadata.nudge.title')" data-test="metadata-nudge">
    {{ $t('metadata.nudge.body') }}
    <template #append>
      <div class="th-action-row">
        <v-btn variant="flat" color="primary" to="/settings/metadata">{{ $t('metadata.nudge.action') }}</v-btn>
        <v-btn variant="text" @click="dismiss">{{ $t('metadata.nudge.dismiss') }}</v-btn>
      </div>
    </template>
  </v-alert>
</template>

<style scoped>
.nudge {
  margin-bottom: 24px;
}
</style>
