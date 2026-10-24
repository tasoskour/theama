<script setup lang="ts">
import logoMark from '@/assets/logo-mark.svg'

withDefaults(defineProps<{ size?: number; wordmark?: boolean }>(), { size: 36, wordmark: true })
</script>

<template>
  <div class="brand" role="img" :aria-label="$t('app.name')">
    <!-- size is given in base-size px; it is drawn in rem so the logo follows the text size and big screens. -->
    <img :src="logoMark" :width="size" :height="size" :style="{ width: `${size / 16}rem`, height: `${size / 16}rem` }" alt="" class="brand__mark" />
    <div v-if="wordmark" class="brand__text">
      <span class="brand__name th-display">THEAMA</span>
      <span class="brand__greek th-eyebrow">ΘΕΑΜΑ</span>
    </div>
  </div>
</template>

<style scoped>
.brand {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.brand__mark {
  flex: none;
}
.brand__text {
  min-width: 0;
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
  font-size: 0.65rem;
}
</style>
