<script setup lang="ts">
import { ref } from 'vue'
import { mdiMagnify } from '@mdi/js'
import SectionPage from '@/components/SectionPage.vue'

const term = ref('')
</script>

<template>
  <SectionPage section-key="search" :icon="mdiMagnify" title-key="nav.search">
    <template #toolbar>
      <v-text-field
        v-model="term"
        :prepend-inner-icon="mdiMagnify"
        :label="$t('nav.search')"
        autofocus
        clearable
        class="mb-4"
        style="max-width: 640px"
      />
    </template>
  </SectionPage>
</template>
