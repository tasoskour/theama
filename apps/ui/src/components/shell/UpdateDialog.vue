<script setup lang="ts">
import { computed } from 'vue'
import { useAppUpdateStore } from '@/stores/appUpdate'

/** Shown when a new version is found at start-up: update now, update when Theama closes, or skip. */
const update = useAppUpdateStore()
const status = computed(() => update.state?.status)
</script>

<template>
  <v-dialog :model-value="update.open" max-width="30rem" persistent @keydown.esc="status === 'available' ? update.skip() : update.dismiss()">
    <v-card v-if="update.state" role="alertdialog" aria-labelledby="app-update-title" data-test="app-update">
      <v-card-text class="update">
        <h2 id="app-update-title" class="th-display update__title">{{ $t('settings.about.updateDialogTitle') }}</h2>
        <p v-if="status === 'available'" class="th-muted update__text">
          {{ $t('settings.about.updateDialogBody', { version: update.state.version }) }}
        </p>
        <template v-else-if="status === 'error'">
          <p class="update__text update__text--bad" role="alert">{{ $t('settings.about.updateFailed') }}</p>
        </template>
        <template v-else>
          <p class="th-muted update__text" role="status" aria-live="polite">
            {{ $t('settings.about.updateDownloadingNow', { version: update.state.version, percent: update.state.percent ?? 0 }) }}
          </p>
          <v-progress-linear :model-value="update.state.percent ?? 0" color="primary" height="4" rounded aria-hidden="true" />
        </template>
      </v-card-text>
      <v-card-actions v-if="status === 'available'" class="update__actions">
        <v-btn variant="text" data-test="app-update-skip" @click="update.skip()">{{ $t('settings.about.updateSkip') }}</v-btn>
        <v-btn variant="tonal" data-test="app-update-on-close" @click="update.updateOnClose()">{{ $t('settings.about.updateOnClose') }}</v-btn>
        <v-btn variant="flat" color="primary" autofocus data-test="app-update-now" @click="update.updateNow()">{{ $t('settings.about.updateNow') }}</v-btn>
      </v-card-actions>
      <v-card-actions v-else-if="status === 'error'" class="update__actions">
        <v-btn variant="flat" color="primary" autofocus data-test="app-update-close" @click="update.dismiss()">{{ $t('settings.about.updateDialogClose') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.update {
  display: grid;
  gap: 8px;
  padding: 24px 24px 12px;
}
.update__title {
  font-size: 1.3rem;
  margin: 0;
}
.update__text {
  margin: 0 0 4px;
}
.update__text--bad {
  color: rgb(var(--v-theme-error));
}
.update__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 16px 16px;
}
</style>
