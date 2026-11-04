<script setup lang="ts">
import { computed } from 'vue'
import { mdiCheckCircle, mdiOpenInNew } from '@mdi/js'
import type { SetupItem } from '@/setup/content'
import type { SetupStatus } from '@/setup/status'
import { ITEM_CONTENT, LINK_ICON, screenshotFor } from '@/setup/items'
import { openExternal } from '@/composables/useExternalLinks'
import SetupStatusChip from './SetupStatusChip.vue'

const props = defineProps<{
  item: SetupItem
  status: SetupStatus
  open: boolean
  /** Which downloadable apps were found on this computer; missing key or null means unknown. */
  installed?: Partial<Record<'prowlarr' | 'qbittorrent', boolean | null>>
}>()
const emit = defineEmits<{ toggle: []; skip: []; unskip: [] }>()
const content = computed(() => ITEM_CONTENT[props.item])
const multi = computed(() => content.value.groups.length > 1)
</script>

<template>
  <section class="card" :class="`is-${status}`" :data-test="`setup-card-${item}`" :data-status="status">
    <header class="card-head">
      <img class="tile" :src="content.icon" alt="" />
      <div class="titles">
        <h2 class="th-display">{{ $t(`setup.items.${item}.title`) }}</h2>
        <p class="th-muted">{{ $t(`setup.items.${item}.summary`) }}</p>
      </div>
      <SetupStatusChip :status="status" />
      <div class="head-actions">
        <v-btn v-if="status === 'skipped'" variant="tonal" size="small" :data-test="`setup-unskip-${item}`" @click="emit('unskip')">{{ $t('setup.configureNow') }}</v-btn>
        <template v-else>
          <v-btn variant="tonal" size="small" :data-test="`setup-edit-${item}`" @click="emit('toggle')">{{ $t(open ? 'setup.hide' : status === 'configured' ? 'setup.edit' : 'setup.configure') }}</v-btn>
          <v-btn v-if="status !== 'configured'" variant="text" size="small" :data-test="`setup-skip-${item}`" @click="emit('skip')">{{ $t('setup.skip') }}</v-btn>
        </template>
      </div>
    </header>

    <div v-if="open" class="body">
      <div v-for="group in content.groups" :key="group.key" class="group">
        <h3 v-if="multi" class="group-title"><img :src="group.icon" alt="" />{{ $t(`setup.items.${item}.${group.key}.title`) }}</h3>
        <div class="links">
          <template v-for="(resource, i) in group.links" :key="resource">
            <v-btn variant="outlined" size="small" @click="openExternal({ service: 'setup', resource })">
              <img class="link-icon" :src="LINK_ICON[resource]" alt="" />
              {{ $t(`setup.links.${resource}`) }}
              <v-icon :icon="mdiOpenInNew" size="14" end />
            </v-btn>
            <v-chip v-if="i === 0 && group.installable && installed?.[group.installable]" size="small" color="success" variant="tonal" label :data-test="`setup-installed-${group.installable}`">
              <v-icon :icon="mdiCheckCircle" size="16" start />{{ $t('setup.installed') }}
            </v-chip>
          </template>
        </div>
        <ol class="steps">
          <li v-for="n in group.steps" :key="n">
            <span class="counter" aria-hidden="true">{{ n }}</span>
            <div class="step-text">
              <strong>{{ $t(`setup.items.${item}.${group.key}.step${n}`) }}</strong>
              <p class="th-muted">{{ $t(`setup.items.${item}.${group.key}.step${n}d`) }}</p>
              <img v-if="screenshotFor(item, group.key, n)" class="shot" :src="screenshotFor(item, group.key, n)!" :alt="$t(`setup.items.${item}.${group.key}.step${n}`)" loading="lazy" />
            </div>
          </li>
        </ol>
      </div>
      <div class="form-panel"><slot /></div>
    </div>
  </section>
</template>

<style scoped>
.card { border: 1px solid rgb(var(--v-theme-hairline)); border-left-width: 4px; border-radius: var(--th-radius); padding: 20px; display: grid; gap: 16px; background: rgb(var(--v-theme-surface)); }
.card.is-configured { border-left-color: rgb(var(--v-theme-success)); }
.card.is-attention { border-left-color: rgb(var(--v-theme-warning)); }
.card-head { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 16px; }
.tile { width: 48px; height: 48px; border-radius: 12px; flex: none; }
.titles { flex: 1 1 16rem; min-width: 0; }
.titles h2 { font-size: 1.25rem; margin: 0; }
.titles p { margin: 2px 0 0; font-size: .9rem; }
.head-actions { display: flex; gap: 4px; }
.body { display: grid; gap: 24px; }
.group { display: grid; gap: 14px; }
.group + .group { padding-top: 20px; border-top: 1px dashed rgb(var(--v-theme-hairline)); }
.group-title { display: flex; align-items: center; gap: 10px; font-size: 1.05rem; margin: 0; }
.group-title img { width: 28px; height: 28px; border-radius: 8px; }
.links { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.link-icon { width: 18px; height: 18px; border-radius: 4px; margin-right: 8px; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.steps li { display: flex; gap: 14px; align-items: flex-start; }
.counter { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: .85rem; font-weight: 700; background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary)); }
.step-text { min-width: 0; max-width: 78ch; }
.step-text p { margin: 2px 0 0; line-height: 1.6; }
.shot { display: block; max-width: 100%; margin-top: 10px; border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); }
.form-panel { background: rgb(var(--v-theme-surface-variant), .35); border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); padding: 16px; display: grid; gap: 10px; }
</style>
