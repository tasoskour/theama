<script setup lang="ts">
import logoMark from '@/assets/logo-mark.svg'

withDefaults(defineProps<{ size?: number; wordmark?: boolean }>(), { size: 36, wordmark: true })
</script>

<template>
  <div class="brand" role="img" :aria-label="$t('app.name')">
    <img :src="logoMark" :width="size" :height="size" alt="" />
    <div v-if="wordmark" class="brand__text">
      <span class="brand__name th-display">THEAMA</span>
      <span class="brand__greek th-eyebrow">ΘΕΑΜΑ</span>
    </div>
  </div>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1;
}
.brand__name {
  font-size: 1.25rem;
  letter-spacing: 0.22em;
}
.brand__greek {
  margin-top: 4px;
  letter-spacing: 0.4em;
  font-size: 0.6rem;
}
</style>
