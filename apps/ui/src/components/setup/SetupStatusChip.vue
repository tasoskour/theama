<script setup lang="ts">
import type { SetupStatus } from '@/setup/status'
defineProps<{ status: SetupStatus }>()
</script>
<template>
  <v-chip size="small" label variant="tonal" :color="status === 'configured' ? 'success' : status === 'attention' ? 'warning' : undefined" :data-status="status">{{ $t(`setup.status.${status}`) }}</v-chip>
</template>
