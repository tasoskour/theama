<script setup lang="ts">
import { mdiFolderPlusOutline } from '@mdi/js'

withDefaults(defineProps<{ icon: string; titleKey: string; bodyKey: string; showAddFolder?: boolean }>(), {
  // Vue casts an absent Boolean prop to false, so the default must be explicit.
  showAddFolder: true,
})
defineEmits<{ addFolder: [] }>()
</script>

<template>
  <section class="empty" aria-live="polite">
    <v-icon :icon="icon" size="56" color="primary" class="empty__icon" />
    <h2 class="th-display empty__title">{{ $t(titleKey) }}</h2>
    <p class="th-muted empty__body">{{ $t(bodyKey) }}</p>
    <slot />
    <div v-if="showAddFolder" class="empty__cta">
      <v-btn color="primary" size="large" :prepend-icon="mdiFolderPlusOutline" @click="$emit('addFolder')">
        {{ $t('empty.addFolder') }}
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 72px 16px;
  max-width: 560px;
  margin-inline: auto;
}
.empty__icon {
  opacity: 0.9;
}
.empty__title {
  font-size: clamp(1.5rem, 3vw, 2rem);
  margin: 8px 0 0;
}
.empty__body {
  margin: 0;
  line-height: 1.6;
}
.empty__cta {
  margin-top: 16px;
}
</style>
