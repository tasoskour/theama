<script setup lang="ts">
import type { GuideId } from '@/setup/content'
defineProps<{ topic: GuideId }>()
</script>
<template>
  <v-btn class="mb-4" variant="text" size="small" :to="{ path: '/settings/setup', query: { topic } }">{{ $t('setup.instructions') }}</v-btn>
</template>
