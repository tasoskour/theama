<script setup lang="ts">
import { computed } from 'vue'
import { mdiArrowLeft } from '@mdi/js'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const labelKey = computed(() => route.name === 'title' ? 'detail.back' : route.name === 'collection' ? 'collections.back' : null)

function back(): void {
  if (window.history.state?.back) router.back()
  else void router.push({ name: route.name === 'collection' ? 'collections' : 'home' })
}
</script>

<template>
  <v-btn
    v-if="labelKey"
    :icon="mdiArrowLeft"
    :aria-label="$t(labelKey)"
    :title="$t(labelKey)"
    variant="text"
    size="small"
    class="navigation-back th-btn-fixed"
    data-test="navigation-back"
    @click="back"
  />
</template>

<style scoped>
.navigation-back {
  flex: 0 0 auto;
}
.navigation-back,
.navigation-back :deep(*) {
  -webkit-app-region: no-drag;
}
</style>
