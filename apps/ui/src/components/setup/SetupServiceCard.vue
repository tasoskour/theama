<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { mdiCheckCircle, mdiChevronDown, mdiFormatListNumbered, mdiKeyVariant, mdiOpenInNew } from '@mdi/js'
import type { SetupItem } from '@/setup/content'
import type { SetupStatus } from '@/setup/status'
import { ITEM_CONTENT, LINK_ICON, linkHost, screenshotFor } from '@/setup/items'
import { openExternal } from '@/composables/useExternalLinks'
import SetupStatusChip from './SetupStatusChip.vue'

const props = defineProps<{
  item: SetupItem
  status: SetupStatus
  open: boolean
  /** Which downloadable apps were found on this computer; a missing key means unknown. */
  installed?: Partial<Record<'prowlarr' | 'qbittorrent', boolean | null>>
  /** For cards that cover several sites (subtitles): the only site whose steps are shown. */
  activeGroup?: string
}>()
const emit = defineEmits<{ toggle: []; skip: []; unskip: [] }>()
const content = computed(() => ITEM_CONTENT[props.item])
const groups = computed(() => (props.activeGroup ? content.value.groups.filter((g) => g.key === props.activeGroup) : content.value.groups))
const guideOverride = ref<boolean | null>(null)
const guideOpen = computed(() => guideOverride.value ?? props.status !== 'configured')
const guideEl = ref<HTMLElement | null>(null)
async function showGuide(): Promise<void> {
  guideOverride.value = true
  await nextTick()
  guideEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
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
      <section class="form-panel" :aria-labelledby="`form-title-${item}`">
        <div class="form-head">
          <span class="key-badge" aria-hidden="true"><v-icon :icon="mdiKeyVariant" size="18" /></span>
          <h3 :id="`form-title-${item}`">{{ $t(`setup.items.${item}.formTitle`) }}</h3>
        </div>
        <slot />
        <p class="need-help">
          {{ $t('setup.needHelp') }}
          <v-btn variant="text" size="small" density="comfortable" data-test="setup-show-guide" @click="showGuide">{{ $t('setup.showHow') }}</v-btn>
        </p>
      </section>

      <section ref="guideEl" class="guide" :aria-labelledby="`guide-title-${item}`">
        <h3 :id="`guide-title-${item}`" class="guide-title">
          <button type="button" class="guide-toggle" :aria-expanded="guideOpen" :data-test="`setup-guide-toggle-${item}`" @click="guideOverride = !guideOpen">
            <v-icon :icon="mdiFormatListNumbered" size="20" />
            <span>{{ $t('setup.guideHeading') }}</span>
            <v-icon :icon="mdiChevronDown" size="20" class="chev" :class="{ flipped: guideOpen }" />
          </button>
        </h3>
        <div v-if="guideOpen" class="guide-body">
          <div v-for="group in groups" :key="group.key" class="group">
            <h4 v-if="content.groups.length > 1" class="group-title"><img :src="group.icon" alt="" />{{ $t(`setup.items.${item}.${group.key}.title`) }}</h4>
            <div class="links">
              <div v-for="(resource, i) in group.links" :key="resource" class="link-wrap">
                <button type="button" class="link-tile" @click="openExternal({ service: 'setup', resource })">
                  <img :src="LINK_ICON[resource]" alt="" />
                  <span class="link-text">
                    <strong>{{ $t(`setup.links.${resource}`) }}</strong>
                    <small>{{ linkHost(resource) }}</small>
                  </span>
                  <v-icon :icon="mdiOpenInNew" size="16" />
                  <span v-if="i === 0 && group.installable && installed?.[group.installable]" class="sr-only">, {{ $t('setup.installed') }}</span>
                </button>
                <span v-if="i === 0 && group.installable && installed?.[group.installable]" class="installed-badge" :data-test="`setup-installed-${group.installable}`" aria-hidden="true">
                  <v-icon :icon="mdiCheckCircle" size="14" />{{ $t('setup.installed') }}
                </span>
              </div>
            </div>
            <ol class="steps">
              <li v-for="n in group.steps" :key="n" :class="{ last: n === group.steps && item !== 'prowlarr' }">
                <span class="counter" aria-hidden="true">{{ n }}</span>
                <div class="step-text">
                  <strong>{{ $t(`setup.items.${item}.${group.key}.step${n}`) }}</strong>
                  <p>{{ $t(`setup.items.${item}.${group.key}.step${n}d`) }}</p>
                  <img v-if="screenshotFor(item, group.key, n)" class="shot" :src="screenshotFor(item, group.key, n)!" :alt="$t(`setup.items.${item}.${group.key}.step${n}`)" loading="lazy" />
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.card { border: 1px solid rgb(var(--v-theme-hairline)); border-left-width: 4px; border-radius: calc(var(--th-radius) + 2px); padding: 24px; display: grid; gap: 18px; background: rgb(var(--v-theme-surface)); }
.card.is-configured { border-left-color: rgb(var(--v-theme-success)); }
.card.is-attention { border-left-color: rgb(var(--v-theme-warning)); }
.card-head { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 16px; }
.tile { width: 52px; height: 52px; border-radius: 14px; flex: none; box-shadow: 0 0 0 1px rgb(var(--v-theme-hairline)); }
.titles { flex: 1 1 16rem; min-width: 0; }
.titles h2 { font-size: 1.3rem; margin: 0; }
.titles p { margin: 2px 0 0; font-size: .92rem; }
.head-actions { display: flex; gap: 4px; }
.body { display: grid; gap: 22px; }
h3, h4, p { margin: 0; }

.form-panel { border: 1px solid rgb(var(--v-theme-primary), .55); border-left-width: 4px; border-radius: var(--th-radius); background: rgb(var(--v-theme-primary), .06); padding: 18px 20px; display: grid; gap: 12px; }
.form-head { display: flex; align-items: center; gap: 10px; }
.form-head h3 { font-size: 1.05rem; font-weight: 700; }
.key-badge { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary)); flex: none; }
.need-help { font-size: .88rem; color: rgb(var(--v-theme-on-surface-variant)); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }

.guide-title { font-size: 1rem; }
.guide-toggle { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 4px; background: none; border: 0; border-bottom: 1px solid rgb(var(--v-theme-hairline)); color: inherit; font: inherit; font-weight: 600; cursor: pointer; text-align: left; }
.guide-toggle:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.guide-toggle span { flex: 1; }
.chev { transition: transform .15s; }
.chev.flipped { transform: rotate(180deg); }
.guide-body { display: grid; gap: 22px; padding-top: 16px; }
.group { display: grid; gap: 16px; }
.group-title { display: flex; align-items: center; gap: 10px; font-size: 1.05rem; }
.group-title img { width: 28px; height: 28px; border-radius: 8px; }

.links { display: flex; flex-wrap: wrap; gap: 12px 14px; padding-top: 6px; }
.link-wrap { position: relative; }
.link-tile { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); background: rgb(var(--v-theme-surface)); color: inherit; font: inherit; cursor: pointer; text-align: left; transition: box-shadow .15s, border-color .15s; }
.link-tile:hover, .link-tile:focus-visible { border-color: rgb(var(--v-theme-primary)); box-shadow: 0 2px 10px rgb(0 0 0 / .25); outline: none; }
.link-tile img { width: 30px; height: 30px; border-radius: 8px; flex: none; }
.link-text { display: grid; line-height: 1.25; }
.link-text small { color: rgb(var(--v-theme-on-surface-variant)); font-size: .75rem; }
.installed-badge { position: absolute; top: -10px; right: -6px; display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px 2px 6px; border-radius: 999px; background: rgb(var(--v-theme-success)); color: rgb(var(--v-theme-on-success)); font-size: .72rem; font-weight: 700; line-height: 1.4; white-space: nowrap; pointer-events: none; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.steps { list-style: none; margin: 0; padding: 0; display: grid; }
.steps li { position: relative; display: flex; gap: 14px; align-items: flex-start; padding-bottom: 18px; }
.steps li:not(:last-child)::before { content: ''; position: absolute; left: 14px; top: 32px; bottom: 2px; width: 2px; background: rgb(var(--v-theme-hairline)); }
.counter { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: .85rem; font-weight: 700; background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary)); position: relative; }
.last .counter { box-shadow: 0 0 0 4px rgb(var(--v-theme-primary), .3); }
.step-text { min-width: 0; max-width: 78ch; padding-top: 3px; }
.step-text strong { font-weight: 600; }
.step-text p { margin-top: 2px; line-height: 1.6; font-size: .92rem; color: rgb(var(--v-theme-on-surface-variant)); }
.shot { display: block; max-width: 100%; margin-top: 10px; border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); box-shadow: 0 4px 16px rgb(0 0 0 / .25); }
</style>
