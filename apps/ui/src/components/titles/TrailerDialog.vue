<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { mdiArrowLeft, mdiClose, mdiOpenInNew } from '@mdi/js'

/**
 * The trailer container: a card that opens over the page with the usual dialog animation, a back/close button
 * and a link to YouTube. The desktop app plays the video on the card's black video area (it lays a locked-down
 * view exactly over it), so the page has to measure that area and keep the app told where it is.
 */
const props = defineProps<{ videoId: string; title: string }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ youtube: [] }>()

const stage = ref<HTMLElement | null>(null)
const playing = ref(false)
let observer: ResizeObserver | null = null

function bounds(): { x: number; y: number; width: number; height: number } | null {
  const r = stage.value?.getBoundingClientRect()
  if (!r || r.width < 1 || r.height < 1) return null
  return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.round(r.width), height: Math.round(r.height) }
}

function follow(): void {
  const b = bounds()
  if (b && playing.value) void window.theama?.trailer.setBounds(b)
}

/** Called once the open animation has finished, so the area is where it will stay. */
async function start(): Promise<void> {
  await nextTick()
  const b = bounds()
  if (!b || !open.value || !window.theama) return
  await window.theama.trailer.show({ id: props.videoId, bounds: b })
  playing.value = true
  observer = new ResizeObserver(follow)
  if (stage.value) observer.observe(stage.value)
  window.addEventListener('resize', follow)
}

function stop(): void {
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', follow)
  if (playing.value || window.theama) void window.theama?.trailer.hide()
  playing.value = false
}

// The video goes away the moment the card starts closing, not after its closing animation.
watch(open, (isOpen) => {
  if (!isOpen) stop()
})

const offClosed = window.theama?.trailer.onClosed(() => {
  open.value = false
})
onBeforeUnmount(() => {
  offClosed?.()
  stop()
})
</script>

<template>
  <v-dialog v-model="open" width="auto" scrim="black" transition="dialog-bottom-transition" @after-enter="start">
    <v-card class="trailer" role="dialog" :aria-label="$t('detail.trailerTitle', { title })" data-test="trailer-dialog">
      <header class="trailer__bar">
        <v-btn variant="text" :prepend-icon="mdiArrowLeft" data-test="trailer-back" @click="open = false">{{ $t('detail.trailerBack') }}</v-btn>
        <span class="trailer__title th-display">{{ $t('detail.trailerTitle', { title }) }}</span>
        <v-btn variant="text" :append-icon="mdiOpenInNew" data-test="trailer-youtube" @click="emit('youtube')">{{ $t('detail.trailerYoutube') }}</v-btn>
        <v-btn icon variant="text" size="small" :aria-label="$t('detail.trailerClose')" :title="$t('detail.trailerClose')" data-test="trailer-close" @click="open = false">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path :d="mdiClose" fill="currentColor" /></svg>
        </v-btn>
      </header>
      <div ref="stage" class="trailer__stage">
        <v-progress-circular v-if="!playing" indeterminate color="primary" size="36" :aria-label="$t('common.loading')" />
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.trailer {
  /* As wide as fits, but never so tall that the 16:9 video area is cut off. */
  width: min(1100px, 92vw, calc((100vh - 120px) * 1.7778));
  overflow: hidden;
  border-radius: var(--th-radius-lg) var(--th-radius-lg) 0 0 !important;
}
.trailer__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 56px;
  padding: 0 8px 0 4px;
  border-bottom: 1px solid rgba(var(--v-theme-hairline), 0.7);
}
.trailer__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.1rem;
}
.trailer__stage {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}
@media (max-width: 600px) {
  .trailer__bar :deep(.v-btn:nth-child(3) .v-btn__content) {
    display: none;
  }
}
</style>
