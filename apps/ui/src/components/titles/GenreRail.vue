<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { TitleKind } from '@theama/contracts'
import { useTitles } from '@/composables/useTitles'
import PosterRail from './PosterRail.vue'

/** A short, lazy-loaded shelf shared by Home and the library section pages. */
const RAIL = 24
const props = defineProps<{ genre: string; kind?: TitleKind; browseAll?: boolean }>()
defineEmits<{ seeAll: [] }>()

// Home can have dozens of genres; each rail only asks for its titles once it is about to be seen.
const near = ref(false)
const root = ref<HTMLElement | null>(null)
const list = useTitles({ kind: () => (near.value ? props.kind : null), sort: 'added', limit: RAIL, genres: ref([props.genre]) })

let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      near.value = true
      void list.reload()
      observer?.disconnect()
    },
    { rootMargin: '600px 0px' },
  )
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div v-if="!list.loaded.value" ref="root" class="genre-rail__wait" aria-hidden="true" />
  <PosterRail v-else-if="list.total.value > 0" :heading="genre" :titles="list.items.value" :total="list.total.value" :browse-all="browseAll" @see-all="$emit('seeAll')" />
</template>

<style scoped>
/* Roughly one rail tall, so the page does not jump as rails fill in. */
.genre-rail__wait {
  min-height: 20rem;
}
</style>
