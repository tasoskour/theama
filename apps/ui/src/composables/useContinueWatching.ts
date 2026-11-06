import { onScopeDispose, ref, watch } from 'vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ContinueList, type ContinueItem, type TitleKind } from '@theama/contracts'
import { useLatestRequest, useRefresh } from './useRefresh'
import { useConnectionStore } from '@/stores/connection'
import { formatClock } from '@/utils/format'

/** The "continue watching" items, kept fresh when the library or what was watched changes. */
export function useContinueWatching(limit = 20, kind: () => TitleKind | undefined = () => undefined) {
  const { t } = useI18n()
  const connection = useConnectionStore()
  const items = ref<ContinueItem[]>([])

  const latest = useLatestRequest()
  const refresh = useRefresh(load)
  async function load(): Promise<void> {
    const client = connection.client
    if (!client) return
    await latest(signal => client.get('/playback/continue', ContinueList, { limit, kind: kind() }, { signal }), result => { items.value = result.items })
  }

  watch(() => connection.phase, (p) => p === 'connected' && void load(), { immediate: true })
  onScopeDispose(
    connection.onEvent((e) => {
      if (e.type === 'library.changed') refresh.schedule()
    }),
  )

  const titles = computed(() => items.value.map(i => i.summary))
  const captions = computed(() => Object.fromEntries(items.value.map(i => {
    const time = formatClock(i.resumeSeconds)
    const caption = i.label
      ? (i.resumeSeconds !== null ? t('play.resumeLabel', { label: i.label, time }) : `${t('play.upNext')} ${i.label}`)
      : (i.resumeSeconds !== null ? t('play.resumeFilm', { time }) : t('play.resume'))
    return [i.summary.key, caption]
  })))
  return { items, titles, captions, reload: load }
}
