<script setup lang="ts">
import { computed } from 'vue'
import { useNextUpStore } from '@/stores/nextUp'

/** The countdown shown when an episode ends: start the next one now, or cancel before the time runs out. */
const nextUp = useNextUpStore()
const progress = computed(() => {
  const total = nextUp.current?.countdownSeconds ?? 0
  return total > 0 ? Math.max(0, (nextUp.remaining / total) * 100) : 0
})
</script>

<template>
  <v-dialog :model-value="nextUp.open" max-width="28rem" persistent @keydown.esc="nextUp.cancel()">
    <v-card v-if="nextUp.current" role="alertdialog" aria-labelledby="next-up-title" data-test="next-up">
      <v-card-text class="next-up">
        <span class="th-muted next-up__kicker">{{ $t('play.nextUpTitle') }}</span>
        <h2 id="next-up-title" class="th-display next-up__title">{{ nextUp.current.title }} · {{ nextUp.current.next.label }}</h2>
        <p class="th-muted next-up__count" role="status" aria-live="polite" data-test="next-up-count">
          {{ $t('play.nextUpIn', { label: nextUp.current.next.label, seconds: nextUp.remaining }, nextUp.remaining) }}
        </p>
        <v-progress-linear :model-value="progress" color="primary" height="4" rounded aria-hidden="true" />
      </v-card-text>
      <v-card-actions class="next-up__actions">
        <v-btn variant="text" data-test="next-up-cancel" @click="nextUp.cancel()">{{ $t('play.cancel') }}</v-btn>
        <v-btn variant="flat" color="primary" autofocus data-test="next-up-play" @click="nextUp.playNow()">{{ $t('play.playNow') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.next-up {
  display: grid;
  gap: 8px;
  padding: 24px 24px 12px;
}
.next-up__kicker {
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.next-up__title {
  font-size: 1.3rem;
  margin: 0;
}
.next-up__count {
  margin: 0 0 4px;
}
.next-up__actions {
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 16px 16px;
}
</style>
