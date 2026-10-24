<script setup lang="ts">
import { computed } from 'vue'
import { mdiMenuDown, mdiPlay } from '@mdi/js'
import { usePlayersStore } from '@/stores/players'

const props = withDefaults(
  defineProps<{
    fileId: number | null
    label: string
    /** Why it cannot be played right now (offline drive, nothing to play); shown as the hint. */
    blockedReason?: string | null
    size?: 'default' | 'large' | 'small'
    /** A compact round icon instead of a labelled button, for episode rows. */
    icon?: boolean
    /** There is a remembered position, so "play from the start" is offered next to the players. */
    resumable?: boolean
  }>(),
  { blockedReason: null, size: 'large', icon: false, resumable: false },
)
const emit = defineEmits<{ played: [ok: boolean] }>()

const players = usePlayersStore()
const disabled = computed(() => props.fileId === null || props.blockedReason !== null || !players.canPlay)

async function start(playerId?: string, fromStart = false): Promise<void> {
  if (props.fileId === null || disabled.value) return
  const result = await players.play(props.fileId, playerId, fromStart)
  emit('played', result.ok)
}
</script>

<template>
  <v-btn
    v-if="icon"
    icon
    size="small"
    variant="text"
    color="primary"
    class="play__icon"
    :disabled="disabled"
    :loading="players.starting"
    :aria-label="label"
    :title="blockedReason ?? label"
    data-test="play-episode"
    @click="start()"
  >
    <svg viewBox="0 0 24 24" class="th-icon play__glyph" aria-hidden="true"><path :d="mdiPlay" fill="currentColor" /></svg>
  </v-btn>
  <v-btn-group v-else variant="flat" color="primary" density="comfortable" class="play" :class="`play--${size}`">
    <v-btn :size="size" :prepend-icon="mdiPlay" :disabled="disabled" :loading="players.starting" data-test="play" :title="blockedReason ?? undefined" class="play__main th-btn-fixed" @click="start()">{{ label }}</v-btn>
    <v-menu location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn v-bind="menuProps" :size="size" :disabled="disabled || (players.available.length < 2 && !resumable)" :aria-label="$t('play.with')" data-test="play-with" class="play__more th-btn-fixed">
          <svg viewBox="0 0 24 24" class="th-icon play__glyph" aria-hidden="true"><path :d="mdiMenuDown" fill="currentColor" /></svg>
        </v-btn>
      </template>
      <v-list density="compact" :aria-label="$t('play.with')">
        <v-list-item v-if="resumable" :title="$t('play.fromStart')" data-test="play-from-start" @click="start(undefined, true)" />
        <v-list-subheader v-if="players.available.length > 1">{{ $t('play.with') }}</v-list-subheader>
        <v-list-item v-for="p in (players.available.length > 1 ? players.available : [])" :key="p.id" :title="p.name" :subtitle="p.isDefault ? $t('play.default') : undefined" @click="start(p.id)" />
      </v-list>
    </v-menu>
  </v-btn-group>
</template>

<style scoped>
/* One solid control: a play segment and a chevron segment sharing a single rounded outline. */
/* Heights are minimums so a longer label or larger text wraps instead of clipping. */
.play {
  height: auto;
  min-height: 2.75rem;
  max-width: 100%;
  border-radius: var(--th-radius);
  overflow: hidden;
  box-shadow: none;
}
.play--small {
  min-height: 2rem;
}
.play--default {
  min-height: 2.4rem;
}
.play__icon {
  min-width: 2.75rem;
  min-height: 2.75rem;
}
.play__glyph {
  width: 1.4em;
  height: 1.4em;
}
.play :deep(.v-btn) {
  height: auto;
  min-height: 100%;
  border-radius: 0;
  letter-spacing: 0;
  transition: filter var(--th-motion);
}
.play :deep(.v-btn:hover:not(:disabled)) {
  filter: brightness(1.08);
}
.play :deep(.v-btn:active:not(:disabled)) {
  filter: brightness(0.96);
}
.play__main {
  min-width: 0;
  padding-inline: 18px 20px;
  font-weight: 600;
}
.play__main :deep(.v-btn__content) {
  white-space: normal;
  text-align: start;
}
.play__more {
  min-width: 0;
  width: 2.5rem;
  padding: 0;
  border-left: 1px solid rgba(0, 0, 0, 0.18);
}
</style>
