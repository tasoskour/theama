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
  }>(),
  { blockedReason: null, size: 'large', icon: false },
)
const emit = defineEmits<{ played: [ok: boolean] }>()

const players = usePlayersStore()
const disabled = computed(() => props.fileId === null || props.blockedReason !== null || !players.canPlay)

async function start(playerId?: string): Promise<void> {
  if (props.fileId === null || disabled.value) return
  const result = await players.play(props.fileId, playerId)
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
    :disabled="disabled"
    :loading="players.starting"
    :aria-label="label"
    :title="blockedReason ?? label"
    data-test="play-episode"
    @click="start()"
  >
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path :d="mdiPlay" fill="currentColor" /></svg>
  </v-btn>
  <v-btn-group v-else variant="flat" color="primary" divided density="comfortable">
    <v-btn :size="size" :prepend-icon="mdiPlay" :disabled="disabled" :loading="players.starting" data-test="play" :title="blockedReason ?? undefined" @click="start()">{{ label }}</v-btn>
    <v-menu location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn v-bind="menuProps" :size="size" :disabled="disabled || players.available.length < 2" :aria-label="$t('play.with')" data-test="play-with">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path :d="mdiMenuDown" fill="currentColor" /></svg>
        </v-btn>
      </template>
      <v-list density="compact" :aria-label="$t('play.with')">
        <v-list-subheader>{{ $t('play.with') }}</v-list-subheader>
        <v-list-item v-for="p in players.available" :key="p.id" :title="p.name" :subtitle="p.isDefault ? $t('play.default') : undefined" @click="start(p.id)" />
      </v-list>
    </v-menu>
  </v-btn-group>
</template>
