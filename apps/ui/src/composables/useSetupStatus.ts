import { computed, onScopeDispose, ref, watch } from 'vue'
import { useConnectionStore } from '@/stores/connection'
import { useLibraryStore } from '@/stores/library'
import { useMetadataStore } from '@/stores/metadata'
import { usePlayersStore } from '@/stores/players'
import { useDownloadsStore } from '@/stores/downloads'
import { useSubtitlesStore } from '@/stores/subtitles'
import { useServiceStore } from '@/stores/service'
import { useSetupStore } from '@/stores/setup'
import { clientStatus, libraryStatus, metadataStatus, playerStatus, withSkip, type SetupStatus } from '@/setup/status'
import type { GuideId } from '@/setup/content'

export function useSetupStatus() {
  const connection = useConnectionStore()
  const library = useLibraryStore()
  const metadata = useMetadataStore()
  const players = usePlayersStore()
  const downloads = useDownloadsStore()
  const subtitles = useSubtitlesStore()
  const service = useServiceStore()
  const setup = useSetupStore()
  const refreshing = ref(false)
  const subtitleLoaded = ref(false)
  const downloadLoaded = ref(false)
  let refreshAgain = false
  service.watchStatus()

  async function refresh(): Promise<void> {
    if (refreshing.value) { refreshAgain = true; return }
    refreshing.value = true
    const connected = connection.isConnected
    subtitleLoaded.value = downloadLoaded.value = false
    try {
      await Promise.allSettled([
        service.refresh(), players.load(),
        ...(connected ? [library.load(), metadata.load(),
          subtitles.load().then(() => { subtitleLoaded.value = true }),
          downloads.load().then(() => { downloadLoaded.value = downloads.client !== null && downloads.indexer !== null }),
        ] : []),
      ])
    } finally {
      refreshing.value = false
      if (refreshAgain) { refreshAgain = false; void refresh() }
    }
  }
  watch(() => connection.phase, () => void refresh(), { immediate: true })
  onScopeDispose(connection.onEvent((event) => {
    if (event.type === 'library.changed' || event.type === 'scan.finished') void library.load()
  }))

  const statuses = computed<Partial<Record<GuideId, SetupStatus>>>(() => {
    const connected = connection.isConnected
    const subtitleValues = subtitles.providers.filter((p) => p.configured).map((p) => subtitles.verification[p.id] ?? 'unknown')
    let subtitle: SetupStatus = !connected || !subtitleLoaded.value ? 'unavailable' : !subtitleValues.length ? 'not_configured'
      : subtitleValues.includes('failed') ? 'attention' : subtitleValues.every((v) => v === 'verified') ? 'configured' : 'unavailable'
    subtitle = withSkip(subtitle, setup.progress.skipped.includes('subtitles'))
    return {
      service: withSkip(connected ? 'configured' : service.status?.state === 'not-installed' ? 'not_configured' : service.status ? 'attention' : 'unavailable', setup.progress.skipped.includes('service')),
      library: withSkip(libraryStatus(library.sources, library.loaded && !library.error, connected), setup.progress.skipped.includes('library')),
      playback: withSkip(playerStatus(players.defaultPlayer, players.loaded && !players.error), setup.progress.skipped.includes('playback')),
      metadata: withSkip(metadataStatus(metadata.status, connected && !metadata.error), setup.progress.skipped.includes('metadata')),
      subtitles: subtitle,
      downloads: withSkip(connected && downloadLoaded.value && !downloads.statusError ? clientStatus(downloads.client?.state) : 'unavailable', setup.progress.skipped.includes('downloads')),
      prowlarr: connected && downloadLoaded.value && !downloads.statusError ? clientStatus(downloads.indexer?.state) : 'unavailable',
    }
  })
  return { statuses, refreshing, refresh }
}
