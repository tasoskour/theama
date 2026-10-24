<script setup lang="ts">
import { ref, watch } from 'vue'
import { CollectionDetail } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import { useConnectionStore } from '@/stores/connection'

const props = defineProps<{ titleKey?: string }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ created: [detail: CollectionDetail] }>()

const connection = useConnectionStore()
const name = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) return
  name.value = ''
  error.value = null
})

async function submit(): Promise<void> {
  const value = name.value.trim()
  if (!value || busy.value || !connection.client) return
  busy.value = true
  error.value = null
  try {
    const created = await connection.client.post('/collections', { name: value, key: props.titleKey }, CollectionDetail)
    open.value = false
    emit('created', created)
  } catch (err) {
    error.value = err instanceof ApiRequestError && err.code === 'duplicate_name' ? 'duplicate' : err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="28rem" aria-labelledby="new-collection-title">
    <v-card class="pa-2" tag="form" @submit.prevent="submit">
      <v-card-title id="new-collection-title" class="th-display">{{ $t('collections.new.title') }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="name"
          :label="$t('collections.new.name')"
          :error-messages="error === 'duplicate' ? $t('collections.new.duplicate') : (error ?? undefined)"
          maxlength="80"
          autofocus
          autocomplete="off"
        />
        <p v-if="titleKey" class="th-muted hint">{{ $t('collections.new.withTitle') }}</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn type="submit" color="primary" variant="flat" :loading="busy" :disabled="!name.trim()">{{ $t('collections.new.create') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.hint {
  margin: 0;
  font-size: 0.85rem;
}
</style>
