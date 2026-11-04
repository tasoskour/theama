<script setup lang="ts">
import { computed } from 'vue'
import type { SetupItem } from '@/setup/content'
import type { SetupStatus } from '@/setup/status'
import { ITEM_CONTENT, screenshotsFor } from '@/setup/items'
import { openExternal } from '@/composables/useExternalLinks'
import SetupStatusChip from './SetupStatusChip.vue'

const props = defineProps<{ item: SetupItem; status: SetupStatus; open: boolean }>()
const emit = defineEmits<{ toggle: []; skip: []; unskip: [] }>()
const content = computed(() => ITEM_CONTENT[props.item])
const shots = computed(() => screenshotsFor(props.item))
</script>

<template>
  <section class="card" :data-test="`setup-card-${item}`" :data-status="status">
    <header class="card-head">
      <h2 class="th-display">{{ $t(`setup.items.${item}.title`) }}</h2>
      <SetupStatusChip :status="status" />
      <span class="spacer" />
      <v-btn v-if="status === 'skipped'" variant="tonal" size="small" :data-test="`setup-unskip-${item}`" @click="emit('unskip')">{{ $t('setup.configureNow') }}</v-btn>
      <template v-else>
        <v-btn variant="tonal" size="small" :data-test="`setup-edit-${item}`" @click="emit('toggle')">{{ $t(open ? 'setup.hide' : status === 'configured' ? 'setup.edit' : 'setup.configure') }}</v-btn>
        <v-btn v-if="status !== 'configured'" variant="text" size="small" :data-test="`setup-skip-${item}`" @click="emit('skip')">{{ $t('setup.skip') }}</v-btn>
      </template>
    </header>
    <p class="th-muted">{{ $t(`setup.items.${item}.summary`) }}</p>
    <div v-if="open" class="body">
      <div class="links">
        <v-btn v-for="resource in content.links" :key="resource" variant="outlined" size="small" @click="openExternal({ service: 'setup', resource })">{{ $t(`setup.links.${resource}`) }}</v-btn>
      </div>
      <ol class="steps">
        <li v-for="n in content.steps" :key="n">{{ $t(`setup.items.${item}.step${n}`) }}</li>
      </ol>
      <div v-if="shots.length" class="shots">
        <img v-for="(src, i) in shots" :key="src" :src="src" :alt="`${$t(`setup.items.${item}.title`)} ${i + 1}`" loading="lazy" />
      </div>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card { border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); padding: 20px; display: grid; gap: 12px; }
.card-head { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.card-head h2 { font-size: 1.3rem; margin: 0; }
.spacer { flex: 1; }
.card p { margin: 0; max-width: 78ch; }
.body { display: grid; gap: 16px; }
.links { display: flex; flex-wrap: wrap; gap: 8px; }
.steps { margin: 0; padding-left: 1.4rem; display: grid; gap: 6px; max-width: 78ch; line-height: 1.6; }
.shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.shots img { width: 100%; border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); }
</style>
