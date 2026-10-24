<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { mdiArrowLeft, mdiArrowLeftBold, mdiArrowRightBold, mdiClose, mdiDeleteOutline, mdiPencilOutline } from '@mdi/js'
import { z } from 'zod'
import { CollectionDetail, type CollectionMember, type CollectionOrder } from '@theama/contracts'
import { ApiRequestError } from '@/api/client'
import PosterArt from '@/components/titles/PosterArt.vue'
import PosterCard from '@/components/titles/PosterCard.vue'
import { useConnectionStore } from '@/stores/connection'
import { moveBetweenCards } from '@/utils/gridNav'

const route = useRoute()
const router = useRouter()
const connection = useConnectionStore()

const detail = ref<CollectionDetail | null>(null)
const missing = ref(false)
const error = ref<string | null>(null)
const order = ref<CollectionOrder | undefined>(undefined)
const heading = ref<HTMLElement | null>(null)

const id = computed(() => Number(route.query.id))
const editable = computed(() => detail.value?.summary.kind === 'user')
/** Moving things around only makes sense in the person's own order. */
const arranging = computed(() => editable.value && detail.value?.order === 'custom')

async function load(): Promise<void> {
  if (!connection.client || !Number.isInteger(id.value)) return
  try {
    detail.value = await connection.client.get(`/collections/${id.value}`, CollectionDetail, { order: order.value })
    missing.value = false
    error.value = null
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'not_found') {
      detail.value = null
      missing.value = true
    } else error.value = err instanceof Error ? err.message : String(err)
  }
}

watch([() => connection.phase, id], () => connection.phase === 'connected' && void load().then(() => nextTick(() => heading.value?.focus())), { immediate: true })
onScopeDispose(
  connection.onEvent((e) => {
    if (e.type === 'library.changed') void load()
  }),
)

function back(): void {
  if (window.history.state?.back) router.back()
  else void router.push({ name: 'collections' })
}

async function setOrder(next: CollectionOrder): Promise<void> {
  order.value = next
  await load()
}

// --- the person's own collections -------------------------------------------
const busy = ref(false)

async function run(action: () => Promise<unknown>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await action()
    error.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

const orderKeys = computed(() => (detail.value?.members ?? []).flatMap((m) => (m.titleKey ? [m.titleKey] : [])))

function move(m: CollectionMember, by: -1 | 1): Promise<void> {
  return run(async () => {
    const keys = [...orderKeys.value]
    const from = keys.indexOf(m.titleKey ?? '')
    const to = from + by
    if (from < 0 || to < 0 || to >= keys.length || !connection.client) return
    ;[keys[from], keys[to]] = [keys[to]!, keys[from]!]
    detail.value = await connection.client.put(`/collections/${id.value}/order`, { keys }, CollectionDetail)
  })
}

function removeMember(m: CollectionMember): Promise<void> {
  return run(async () => {
    if (!m.titleKey || !connection.client) return
    detail.value = await connection.client.delete(`/collections/${id.value}/members?key=${encodeURIComponent(m.titleKey)}`, CollectionDetail)
  })
}

const renaming = ref(false)
const newName = ref('')
const nameError = ref<string | null>(null)
function beginRename(): void {
  newName.value = detail.value?.summary.name ?? ''
  nameError.value = null
  renaming.value = true
}
function rename(): Promise<void> {
  return run(async () => {
    const name = newName.value.trim()
    if (!name || !connection.client) return
    try {
      detail.value = await connection.client.patch(`/collections/${id.value}`, { name }, CollectionDetail)
      renaming.value = false
    } catch (err) {
      nameError.value = err instanceof ApiRequestError && err.code === 'duplicate_name' ? 'duplicate' : err instanceof Error ? err.message : String(err)
    }
  })
}

const deleting = ref(false)
function deleteCollection(): Promise<void> {
  return run(async () => {
    if (!connection.client) return
    await connection.client.delete(`/collections/${id.value}`, z.object({ deleted: z.boolean() }))
    deleting.value = false
    void router.replace({ name: 'collections' })
  })
}

const summary = computed(() => detail.value?.summary ?? null)
const heroStyle = computed(() => {
  const backdrop = connection.assetUrl(detail.value?.backdropUrl)
  if (!backdrop) return {}
  const veil = 'linear-gradient(90deg, rgba(var(--v-theme-surface), 0.96), rgba(var(--v-theme-surface), 0.72))'
  return { backgroundImage: `${veil}, url("${backdrop}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
})
</script>

<template>
  <div class="th-page th-page--wide detail">
    <v-btn variant="text" :prepend-icon="mdiArrowLeft" class="back" @click="back">{{ $t('collections.back') }}</v-btn>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
    <section v-if="missing" class="gone">
      <h1 class="th-display">{{ $t('collections.gone') }}</h1>
      <p class="th-muted">{{ $t('collections.goneHint') }}</p>
    </section>

    <template v-if="detail && summary">
      <section class="hero" :style="heroStyle">
        <p class="th-eyebrow">{{ $t(`collections.kind.${summary.kind}`) }}</p>
        <h1 ref="heading" tabindex="-1" class="th-display hero__title">{{ summary.name }}</h1>
        <p class="th-muted count" data-test="collection-count">
          {{ summary.kind === 'official' ? $t('collections.inLibrary', { local: summary.localCount, total: summary.memberCount }) : $t('collections.titles', summary.memberCount) }}
        </p>
        <p v-if="summary.overview" class="overview">{{ summary.overview }}</p>

        <div class="actions">
          <v-btn-toggle
            v-if="detail.orders.length > 1"
            :model-value="detail.order"
            mandatory
            divided
            density="comfortable"
            color="primary"
            variant="outlined"
            class="wrap-toggle"
            :aria-label="$t('collections.order')"
            @update:model-value="(v: CollectionOrder) => setOrder(v)"
          >
            <v-btn v-for="o in detail.orders" :key="o" :value="o" :aria-pressed="detail.order === o">{{ $t(`collections.orders.${o}`) }}</v-btn>
          </v-btn-toggle>
          <span v-else class="th-muted">{{ $t('collections.orders.release') }}</span>
          <template v-if="editable">
            <v-btn variant="text" :prepend-icon="mdiPencilOutline" data-test="rename-collection" @click="beginRename">{{ $t('collections.rename') }}</v-btn>
            <v-btn variant="text" color="error" :prepend-icon="mdiDeleteOutline" data-test="delete-collection" @click="deleting = true">{{ $t('collections.delete') }}</v-btn>
          </template>
        </div>
        <p v-if="summary.kind === 'official'" class="th-muted note">{{ $t('collections.officialNote') }}</p>
      </section>

      <p v-if="detail.members.length === 0" class="th-muted empty">{{ $t('collections.emptyCollection') }}</p>

      <ol v-else class="members" :aria-label="summary.name" @keydown="moveBetweenCards($event, '[data-title-key]')">
        <li v-for="m in detail.members" :key="m.titleKey ?? m.title + m.position" class="member">
          <div class="member__pos th-muted" aria-hidden="true">{{ m.position }}</div>
          <PosterCard v-if="m.summary" :title="m.summary" />
          <!-- A contextual entry: known to the collection, not in the library. It is never a link and never plays. -->
          <div v-else class="ghost" data-test="contextual-member">
            <div class="ghost__art">
              <PosterArt :seed="`ghost:${m.title}`" :title="m.title" :year="m.year" kind="movie" :image-url="connection.assetUrl(m.posterUrl)" />
            </div>
            <div class="ghost__meta">
              <div class="ghost__title">{{ m.title }}</div>
              <div class="th-muted ghost__detail">{{ m.year ?? '' }}<span v-if="m.year"> · </span>{{ $t('collections.notInLibrary') }}</div>
            </div>
          </div>
          <div v-if="arranging && m.titleKey" class="member__tools" role="group" :aria-label="$t('collections.arrange', { name: m.title })">
            <v-btn icon size="x-small" variant="text" :disabled="busy || m.position === 1" :aria-label="$t('collections.earlier', { name: m.title })" @click="move(m, -1)">
              <svg class="th-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiArrowLeftBold" fill="currentColor" /></svg>
            </v-btn>
            <v-btn icon size="x-small" variant="text" :disabled="busy || m.position === detail.members.length" :aria-label="$t('collections.later', { name: m.title })" @click="move(m, 1)">
              <svg class="th-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiArrowRightBold" fill="currentColor" /></svg>
            </v-btn>
            <v-btn icon size="x-small" variant="text" :disabled="busy" :aria-label="$t('collections.removeFrom', { name: m.title })" @click="removeMember(m)">
              <svg class="th-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiClose" fill="currentColor" /></svg>
            </v-btn>
          </div>
          <v-btn v-else-if="editable && m.titleKey" size="small" variant="text" :disabled="busy" @click="removeMember(m)">{{ $t('collections.remove') }}</v-btn>
        </li>
      </ol>
    </template>

    <v-dialog v-model="renaming" max-width="28rem" aria-labelledby="rename-title">
      <v-card class="pa-2" tag="form" @submit.prevent="rename">
        <v-card-title id="rename-title" class="th-display">{{ $t('collections.rename') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="newName"
            :label="$t('collections.new.name')"
            :error-messages="nameError === 'duplicate' ? $t('collections.new.duplicate') : (nameError ?? undefined)"
            maxlength="80"
            autofocus
            autocomplete="off"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="renaming = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn type="submit" color="primary" variant="flat" :loading="busy" :disabled="!newName.trim()">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleting" max-width="29rem" aria-labelledby="delete-title">
      <v-card class="pa-2">
        <v-card-title id="delete-title" class="th-display">{{ $t('collections.deleteTitle', { name: summary?.name ?? '' }) }}</v-card-title>
        <v-card-text>{{ $t('collections.deleteBody') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleting = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" :loading="busy" @click="deleteCollection">{{ $t('collections.deleteConfirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.detail {
  padding-top: 16px;
}
.back {
  margin-left: -12px;
  margin-bottom: 8px;
}
.hero {
  padding: clamp(16px, 3vw, 32px);
  border-radius: calc(var(--th-radius) + 4px);
  background: linear-gradient(135deg, rgb(var(--v-theme-surface-light)), rgb(var(--v-theme-surface)));
  border: 1px solid rgb(var(--v-theme-hairline));
}
.hero__title {
  font-size: clamp(2rem, calc(4.5vw * var(--th-text-scale)), 3.2rem);
  margin: 4px 0 8px;
  outline: none;
}
.count {
  margin: 0 0 12px;
}
.overview {
  max-width: 68ch;
  line-height: 1.55;
  margin: 0 0 16px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.note {
  font-size: 0.82rem;
  margin: 12px 0 0;
}
.empty {
  margin-top: 32px;
}
.members {
  list-style: none;
  margin: 32px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--th-poster-min), 1fr));
  gap: var(--th-poster-gap);
}
.member {
  position: relative;
  display: grid;
  align-content: start;
  gap: 6px;
  justify-items: stretch;
}
.member__pos {
  font-size: 0.78rem;
  letter-spacing: 0.12em;
}
.member__tools {
  display: flex;
  justify-content: center;
}
.ghost {
  display: grid;
  gap: 10px;
}
.ghost__art {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  opacity: 0.45;
  filter: grayscale(0.7);
  border-radius: var(--th-radius);
  outline: 2px dashed rgba(var(--v-theme-on-surface), 0.35);
  outline-offset: -2px;
}
.ghost__title {
  font-weight: 600;
  font-size: 0.92rem;
  line-height: 1.25;
}
.ghost__detail {
  font-size: 0.8rem;
  margin-top: 2px;
}
.gone {
  text-align: center;
  padding: 64px 0;
}
/* A toggle with several long labels wraps instead of scrolling sideways. */
.wrap-toggle.v-btn-toggle {
  height: auto !important;
  max-width: 100%;
  flex-wrap: wrap;
}
</style>
