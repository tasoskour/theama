<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Suggestion, TitleCredit } from '@theama/contracts'
import { useConnectionStore } from '@/stores/connection'
import { useMetadataStore } from '@/stores/metadata'
import { useLatestRequest } from '@/composables/useRefresh'
import AwardsList from './AwardsList.vue'
import PosterArt from './PosterArt.vue'

const props = defineProps<{ credit: TitleCredit }>()
const connection = useConnectionStore()
const metadata = useMetadataStore()
const open = ref(false)
const loading = ref(false)
const error = ref<{ code: string; message: string } | null>(null)
const items = ref<Suggestion[]>([])
const latest = useLatestRequest()
const groups = computed(() => (['movie', 'series'] as const).map((kind) => ({ kind, items: items.value.filter((item) => item.kind === kind) })))
const profileSrc = computed(() => connection.assetUrl(props.credit.profileUrl))
const profileFailed = ref(false)
const initials = computed(() => props.credit.name.trim().split(/\s+/u).filter(Boolean).map((part) => Array.from(part)[0]).filter(Boolean).slice(0, 2).join(''))
watch(profileSrc, () => { profileFailed.value = false })

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  await latest(signal => metadata.personTitles(props.credit.externalId, props.credit.category, signal), (res) => {
    loading.value = false
    if (res.ok) items.value = res.items
    else error.value = res
  }, (err) => {
    loading.value = false
    error.value = { code: 'unreachable', message: err instanceof Error ? err.message : String(err) }
  })
}

watch([open, () => props.credit.externalId, () => props.credit.category], ([shown]) => {
  latest.cancel()
  items.value = []
  error.value = null
  loading.value = false
  if (shown) void load()
})
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" location="top start" max-width="40rem">
    <template #activator="{ props: menuProps }">
      <button v-bind="menuProps" type="button" class="credit" :data-test="`credit-${credit.category}`">
        <span class="credit__portrait" aria-hidden="true">
          <img v-if="profileSrc && !profileFailed" :src="profileSrc" alt="" loading="lazy" decoding="async" width="48" height="64" data-test="credit-photo" @error="profileFailed = true" />
          <span v-else class="credit__initials" data-test="credit-photo-fallback">{{ initials }}</span>
        </span>
        <span class="credit__info">
          <span class="credit__name">{{ credit.name }}</span>
          <span v-if="credit.character" class="th-muted credit__role">{{ credit.character }}</span>
        </span>
      </button>
    </template>

    <v-card class="credit-popover" role="region" :aria-label="$t('detail.personTitles', { name: credit.name })" data-test="credit-popover">
      <v-card-title class="credit-popover__name">{{ credit.name }}</v-card-title>
      <v-card-subtitle>{{ $t(credit.category === 'director' ? 'detail.director' : 'detail.actor') }}</v-card-subtitle>
      <v-divider class="mt-3" />
      <div class="credit-popover__content" data-test="credit-content">
        <AwardsList subject="person" :external-id="credit.externalId" />
        <v-divider />
        <h3 class="credit-popover__heading">{{ $t('detail.otherAvailableTitles') }}</h3>
        <p v-if="credit.relatedTitles.length === 0" class="th-muted credit-popover__empty">{{ $t('detail.noOtherTitles') }}</p>
        <v-list v-else density="compact" class="credit-popover__list" :aria-label="$t('detail.otherAvailableTitles')">
          <v-list-item
            v-for="title in credit.relatedTitles"
            :key="title.key"
            :to="{ name: 'title', query: { key: title.key } }"
            :title="title.title"
            :subtitle="title.year ? String(title.year) : $t(`detail.kind.${title.kind}`)"
            class="credit-popover__title"
            data-test="credit-related-title"
            @click="open = false"
          >
            <template #prepend>
              <div class="credit-popover__poster">
                <PosterArt :seed="title.key" :title="title.title" :year="title.year" :kind="title.kind" :image-url="connection.assetUrl(title.posterUrl)" />
              </div>
            </template>
          </v-list-item>
        </v-list>
        <v-divider />
        <div v-if="loading" class="credit-popover__empty" role="status" data-test="credit-loading">
          <v-progress-circular indeterminate size="20" width="2" class="mr-2" />{{ $t('detail.loadingPersonTitles') }}
        </div>
        <v-alert v-else-if="error" type="warning" variant="tonal" class="ma-3" data-test="credit-error">
          {{ error.message }}
          <router-link v-if="error.code === 'no_key' || error.code === 'invalid_key'" to="/settings/metadata" @click="open = false">{{ $t('match.openSettings') }}</router-link>
          <v-btn variant="text" size="small" data-test="credit-retry" @click="load">{{ $t('common.retry') }}</v-btn>
        </v-alert>
        <template v-for="group in groups" v-else :key="group.kind">
          <h3 class="credit-popover__heading">{{ $t(group.kind === 'movie' ? 'detail.topMovies' : 'detail.topSeries') }}</h3>
          <p v-if="!group.items.length" class="th-muted credit-popover__empty">{{ $t('detail.noPersonTitles') }}</p>
          <ul v-else class="credit-popover__top" :data-test="`credit-top-${group.kind}`">
            <li v-for="title in group.items" :key="`${title.kind}:${title.externalId}`" class="credit-popover__result" data-test="credit-top-title">
              <div class="credit-popover__poster">
                <PosterArt :seed="`${title.kind}:${title.externalId}`" :title="title.title" :year="title.year" :kind="title.kind" :image-url="connection.assetUrl(title.posterUrl)" />
              </div>
              <div class="credit-popover__info">
                <span class="credit__name">{{ title.title }}</span>
                <span class="th-muted"><span v-if="title.year">{{ title.year }} · </span><span v-if="title.rating !== null">{{ $t('detail.personRating', { value: title.rating.toFixed(1) }) }}</span></span>
              </div>
              <v-btn size="small" variant="tonal" color="primary" :to="{ name: 'downloads', query: { kind: title.kind, title: title.title, ...(title.kind === 'movie' && title.year !== null ? { year: String(title.year) } : {}), releases: '1', personId: credit.externalId, personCategory: credit.category, personName: credit.name } }" :aria-label="$t('detail.findPersonReleases', { title: title.title })" data-test="credit-releases" @click="open = false">{{ $t('downloads.suggestions.findReleases') }}</v-btn>
            </li>
          </ul>
        </template>
      </div>
    </v-card>
  </v-menu>
</template>

<style scoped>
.credit {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--th-motion), border-color var(--th-motion);
}
.credit:hover,
.credit:focus-visible,
.credit[aria-expanded='true'] {
  background: rgba(var(--v-theme-primary), 0.09);
  border-color: rgba(var(--v-theme-primary), 0.28);
  outline: none;
}
.credit__portrait {
  display: grid;
  place-items: center;
  flex: 0 0 48px;
  width: 48px;
  height: 64px;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.12);
}
.credit__portrait img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.credit__initials {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 650;
  font-size: 0.9rem;
}
.credit__info {
  display: grid;
  min-width: 0;
  overflow-wrap: anywhere;
}
.credit__name {
  font-weight: 650;
}
.credit__role {
  font-size: 0.85rem;
}
.credit-popover {
  width: min(40rem, calc(100vw - 24px));
  overflow: hidden;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}
.credit-popover__name {
  padding-bottom: 2px;
  font-weight: 700;
}
.credit-popover__empty {
  margin: 0;
  padding: 18px 16px;
  line-height: 1.45;
}
.credit-popover__content {
  min-height: 0;
  overflow-y: auto;
}
.credit-popover__heading {
  padding: 16px 16px 0;
  font-size: 0.9rem;
}
.credit-popover__top {
  list-style: none;
  padding: 8px 16px 16px;
}
.credit-popover__result {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}
.credit-popover__info {
  display: grid;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.credit-popover__result .credit-popover__poster {
  flex-shrink: 0;
  margin-right: 0;
}
@media (max-width: 450px) {
  .credit-popover__result { flex-wrap: wrap; }
  .credit-popover__result .v-btn { margin-left: 3.15rem; }
}
.credit-popover__title {
  min-height: 4.75rem;
}
.credit-popover__poster {
  width: 2.4rem;
  margin-right: 12px;
  border-radius: 5px;
  overflow: hidden;
}
</style>
