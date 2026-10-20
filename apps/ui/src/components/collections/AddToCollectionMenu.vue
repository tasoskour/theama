<script setup lang="ts">
import { ref } from 'vue'
import { z } from 'zod'
import { mdiPlaylistPlus } from '@mdi/js'
import { CollectionList, type CollectionRef, type CollectionSummary } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'
import NewCollectionDialog from './NewCollectionDialog.vue'

const props = defineProps<{ titleKey: string; memberOf: CollectionRef[] }>()
const emit = defineEmits<{ changed: [] }>()

// The reply is the whole collection; the menu only needs to know the request worked.
const Accepted = z.object({}).passthrough()

const connection = useConnectionStore()
const mine = ref<CollectionSummary[]>([])
const creating = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  if (!connection.client) return
  error.value = null
  try {
    mine.value = (await connection.client.get('/collections', CollectionList, { kind: 'user' })).items
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

const isIn = (id: number): boolean => props.memberOf.some((c) => c.id === id)

async function add(c: CollectionSummary): Promise<void> {
  if (!connection.client || isIn(c.id)) return
  try {
    await connection.client.post(`/collections/${c.id}/members`, { key: props.titleKey }, Accepted)
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <v-menu location="bottom start" @update:model-value="(v: boolean) => v && load()">
    <template #activator="{ props: menuProps }">
      <v-btn v-bind="menuProps" variant="outlined" class="th-btn-quiet" :prepend-icon="mdiPlaylistPlus" data-test="add-to-collection">{{ $t('collections.addTo') }}</v-btn>
    </template>
    <v-list density="compact" min-width="240">
      <v-list-item v-for="c in mine" :key="c.id" :title="c.name" :disabled="isIn(c.id)" :subtitle="isIn(c.id) ? $t('collections.alreadyIn') : undefined" @click="add(c)" />
      <v-list-item v-if="mine.length === 0" :title="$t('collections.noneYet')" disabled />
      <v-divider />
      <v-list-item :title="$t('collections.newEllipsis')" data-test="new-collection" @click="creating = true" />
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="ma-2">{{ error }}</v-alert>
    </v-list>
  </v-menu>
  <NewCollectionDialog v-model="creating" :title-key="titleKey" @created="emit('changed')" />
</template>
