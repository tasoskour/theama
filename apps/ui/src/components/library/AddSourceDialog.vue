<script setup lang="ts">
import { mdiFolderOpenOutline } from '@mdi/js'
import type { LibraryType } from '@theama/contracts'
import type { AddFolderFlow } from '@/composables/useAddFolder'

const props = defineProps<{ flow: AddFolderFlow }>()
const emit = defineEmits<{ added: [] }>()

// The flow owns its state as refs; destructured here so the template can v-model them
// (and, being top-level bindings, they unwrap automatically).
const { open, path, type, recursive, busy, error, canBrowse, browse } = props.flow

const TYPES: LibraryType[] = ['movies', 'series', 'videos', 'auto']

async function submit(): Promise<void> {
  if (await props.flow.submit()) emit('added')
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" aria-labelledby="add-source-title">
    <v-card class="pa-2" tag="form" @submit.prevent="submit">
      <v-card-title id="add-source-title" class="th-display">{{ $t('library.dialog.title') }}</v-card-title>
      <v-card-text>
        <div class="path-row">
          <v-text-field
            v-model="path"
            :label="$t('library.dialog.path')"
            :hint="$t('library.dialog.pathHint')"
            persistent-hint
            autofocus
            spellcheck="false"
          />
          <v-btn v-if="canBrowse" variant="tonal" :prepend-icon="mdiFolderOpenOutline" @click="browse()">
            {{ $t('library.browse') }}
          </v-btn>
        </div>

        <fieldset class="type">
          <legend class="th-eyebrow mb-2">{{ $t('library.dialog.type') }}</legend>
          <v-btn-toggle v-model="type" mandatory divided color="primary" variant="outlined" class="types">
            <v-btn v-for="t in TYPES" :key="t" :value="t" :aria-pressed="type === t">{{ $t(`library.types.${t}`) }}</v-btn>
          </v-btn-toggle>
          <p class="th-muted text-caption mt-2">{{ $t(`library.typeHints.${type}`) }}</p>
        </fieldset>

        <v-checkbox v-model="recursive" :label="$t('library.dialog.recursive')" color="primary" hide-details class="mt-2" />

        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn type="submit" color="primary" :loading="busy" :disabled="path.trim() === ''">
          {{ $t('library.dialog.confirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.path-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.type {
  border: 0;
  padding: 0;
  margin: 24px 0 0;
}
.types {
  flex-wrap: wrap;
  height: auto;
}
</style>
