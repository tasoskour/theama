<script setup lang="ts">
import { ref } from 'vue'
import { SETUP_RESOURCES, type SetupResourceId } from '@theama/contracts'
import type { GuideBlock } from '@/setup/content'
import { openExternal } from '@/composables/useExternalLinks'

defineProps<{ blocks: GuideBlock[] }>()
const linkError = ref(false)
async function open(resource: SetupResourceId): Promise<void> {
  linkError.value = false
  try { await openExternal({ service: 'setup', resource }) } catch { linkError.value = true }
}
</script>

<template>
  <div class="guide-blocks">
    <template v-for="(block, index) in blocks" :key="index">
      <p v-if="block.kind === 'paragraph'">{{ block.text }}</p>
      <ol v-else-if="block.kind === 'steps'">
        <li v-for="(item, i) in block.items" :key="i">{{ item }}</li>
      </ol>
      <div v-else-if="block.kind === 'table'" class="table-scroll" tabindex="0" role="region" :aria-label="block.headers.join(' / ')">
        <table>
          <thead><tr><th v-for="(header, i) in block.headers" :key="i" scope="col">{{ header }}</th></tr></thead>
          <tbody><tr v-for="(row, i) in block.rows" :key="i"><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr></tbody>
        </table>
      </div>
      <pre v-else-if="block.kind === 'code'" tabindex="0"><code>{{ block.text }}</code></pre>
      <ul v-else-if="block.kind === 'links'" class="resource-links">
        <li v-for="link in block.items" :key="link.resource">
          <a :href="SETUP_RESOURCES[link.resource]" target="_blank" rel="noopener noreferrer" @click.prevent="open(link.resource)">{{ link.label }} ↗</a>
        </li>
      </ul>
      <div v-else-if="block.kind === 'troubleshooting'" class="problems">
        <details v-for="item in block.items" :key="item.symptom"><summary>{{ item.symptom }}</summary><p>{{ item.solution }}</p></details>
      </div>
    </template>
    <v-alert v-if="linkError" type="error" variant="tonal" role="alert">{{ $t('setup.linkError') }}</v-alert>
  </div>
</template>

<style scoped>
.guide-blocks { display: grid; gap: 16px; line-height: 1.7; overflow-wrap: anywhere; min-width: 0; }
p, ol, ul { margin: 0; }
ol, ul { padding-inline-start: 1.6rem; }
li + li { margin-top: 10px; }
.table-scroll, pre { min-width: 0; max-width: 100%; overflow-x: auto; border: 1px solid rgb(var(--v-theme-hairline)); border-radius: var(--th-radius); }
table { border-collapse: collapse; min-width: 32rem; width: 100%; font-size: .9rem; }
th, td { padding: 12px; text-align: start; vertical-align: top; border-bottom: 1px solid rgb(var(--v-theme-hairline)); }
th { background: rgb(var(--v-theme-surface)); }
pre { padding: 16px; background: rgb(var(--v-theme-surface)); line-height: 1.6; overflow-wrap: normal; }
a { color: rgb(var(--v-theme-primary)); text-underline-offset: .2em; }
details { padding: 12px 0; border-bottom: 1px solid rgb(var(--v-theme-hairline)); }
summary { cursor: pointer; font-weight: 600; }
details p { margin-top: 12px; }
</style>
