<script setup lang="ts">
import { computed } from 'vue'
import { useConnectionStore } from '@/stores/connection'

const connection = useConnectionStore()
const color = computed(() =>
  connection.phase === 'connected' ? 'success' : connection.phase === 'connecting' ? 'warning' : 'error',
)
</script>

<template>
  <router-link to="/settings/advanced/service" class="chip th-hairline" :aria-label="$t(`connection.${connection.phase}`)">
    <span class="dot" :style="{ background: `rgb(var(--v-theme-${color}))` }" aria-hidden="true" />
    <span class="label">{{ $t(`connection.${connection.phase}`) }}</span>
  </router-link>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface-variant));
  text-decoration: none;
}
.chip:hover {
  color: rgb(var(--v-theme-on-surface));
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
