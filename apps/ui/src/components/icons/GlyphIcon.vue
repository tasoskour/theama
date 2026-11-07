<script setup lang="ts">
/**
 * Button glyphs drawn from the supplied heart / play / calendar artwork. Strokes use `currentColor`, so they follow
 * the button's text colour in every theme (MDI path icons can't do strokes, hence a component).
 */
defineProps<{ name: 'heart' | 'heart-filled' | 'play' | 'calendar' }>()
</script>

<template>
  <svg class="th-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path v-if="name === 'heart' || name === 'heart-filled'" d="M12 20.3 3.9 12.2A4.6 4.6 0 0 1 10.4 5.7L12 7.3l1.6-1.6a4.6 4.6 0 0 1 6.5 6.5Z" :fill="name === 'heart-filled' ? 'currentColor' : 'none'" />
    <template v-else-if="name === 'play'">
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.2 16 12l-6 3.8Z" fill="currentColor" />
    </template>
    <template v-else>
      <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
      <path d="M4 10h16M8.5 3.5V7M15.5 3.5V7" />
      <g fill="currentColor" stroke="none">
        <circle cx="8.5" cy="13.4" r="0.95" /><circle cx="12" cy="13.4" r="0.95" /><circle cx="15.5" cy="13.4" r="0.95" />
        <circle cx="8.5" cy="16.8" r="0.95" /><circle cx="12" cy="16.8" r="0.95" /><circle cx="15.5" cy="16.8" r="0.95" />
      </g>
    </template>
  </svg>
</template>
