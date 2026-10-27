<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiMagnify } from '@mdi/js'

// The one search input used by the global search, library filter, identify dialog and logs.
// Everything else (label, placeholder, density, loading, autofocus, aria-label, listeners) falls
// through to the underlying v-text-field.
const model = defineModel<string | null | undefined>()
// The clear button sets the field to null; callers get an empty string, which they can trim.
const text = computed({
  get: () => model.value ?? '',
  set: (v: string | null) => { model.value = v ?? '' },
})

const field = ref<{ $el: HTMLElement } | null>(null)

defineExpose({
  focus: () => field.value?.$el.querySelector('input')?.focus(),
})
</script>

<template>
  <v-text-field
    ref="field"
    v-model="text"
    :prepend-inner-icon="mdiMagnify"
    clearable
    hide-details
    density="compact"
    variant="solo-filled"
    flat
    bg-color="surface-bright"
    autocomplete="off"
    spellcheck="false"
    data-gramm="false"
    class="th-search-control"
  >
    <template #loader="{ color, isActive }">
      <v-progress-linear :color="color" :active="isActive" height="2" indeterminate :aria-label="$t('common.loading')" />
    </template>
  </v-text-field>
</template>
