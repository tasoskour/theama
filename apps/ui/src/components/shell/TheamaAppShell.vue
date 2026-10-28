<script setup lang="ts">
import { computed, defineAsyncComponent, onUnmounted, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import BrandLogo from './BrandLogo.vue'
import ConnectionChip from './ConnectionChip.vue'
import NavigationBackButton from './NavigationBackButton.vue'
import TheamaBottomNavigation from './TheamaBottomNavigation.vue'
import TheamaTopNavigation from './TheamaTopNavigation.vue'
import RecoveryScreen from '@/components/service/RecoveryScreen.vue'
import NextEpisodeDialog from '@/components/titles/NextEpisodeDialog.vue'
import { useGlobalShortcuts } from '@/composables/useGlobalShortcuts'
import { useImmersive } from '@/composables/useImmersive'
import { useConnectionStore } from '@/stores/connection'
import { useNextUpStore } from '@/stores/nextUp'
import { useTitleActionsStore } from '@/stores/titleActions'

// Only fetched when the immersive mode is on; Standard never loads the 3D code.
const ImmersiveBackdrop = defineAsyncComponent(() => import('@/components/immersive/ImmersiveBackdrop.vue'))

const display = useDisplay()
const immersive = useImmersive()
const mobile = computed(() => display.smAndDown.value)
const connection = useConnectionStore()
const titleActions = useTitleActionsStore()
useGlobalShortcuts()
useNextUpStore() // listens for "an episode ended" from the desktop app

// Brief reconnects (a service restart, a missed heartbeat) should not flash the
// recovery screen; only an outage that lasts a moment does.
const showRecovery = ref(false)
let grace: ReturnType<typeof setTimeout> | undefined
watch(
  () => connection.phase,
  (phase) => {
    clearTimeout(grace)
    if (phase === 'unavailable') grace = setTimeout(() => (showRecovery.value = true), connection.everConnected ? 1500 : 0)
    else if (phase === 'connected') showRecovery.value = false
  },
  { immediate: true },
)
onUnmounted(() => clearTimeout(grace))

const splash = computed(() => connection.phase === 'connecting' && !connection.everConnected && !showRecovery.value)
</script>

<template>
  <ImmersiveBackdrop v-if="immersive.active.value" />
  <TheamaTopNavigation v-if="!mobile" />
  <v-app-bar v-if="mobile" flat color="surface" class="th-hairline appbar" density="comfortable">
    <div class="appbar__brand px-4">
      <NavigationBackButton />
      <BrandLogo :size="28" :wordmark="!display.xs.value" />
    </div>
    <v-spacer />
    <div class="pr-3"><ConnectionChip /></div>
  </v-app-bar>

  <v-main class="main">
    <RecoveryScreen v-if="showRecovery" />
    <div v-else-if="splash" class="splash" role="status" :aria-label="$t('connection.connecting')">
      <BrandLogo :size="72" :wordmark="false" />
      <v-progress-linear indeterminate color="primary" class="splash__bar" rounded />
    </div>
    <router-view v-else v-slot="{ Component, route }">
      <transition name="th-fade" mode="out-in">
        <component :is="Component" :key="route.matched[0]?.path ?? route.path" />
      </transition>
    </router-view>
  </v-main>

  <TheamaBottomNavigation v-if="mobile" />
  <NextEpisodeDialog />
  <v-snackbar :model-value="titleActions.message !== null" :timeout="4500" :color="titleActions.color" @update:model-value="titleActions.clear()">
    {{ titleActions.message }}
  </v-snackbar>
</template>

<style scoped>
.appbar {
  border-width: 0 0 1px 0;
}
.appbar__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.main {
  min-height: 100vh;
  min-height: 100dvh;
}
.splash {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 24px;
  min-height: 80vh;
}
.splash__bar {
  width: 10rem;
}
</style>
