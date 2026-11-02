import type { DownloadClientState, LibrarySource, MetadataStatus, PlayerInfo } from '@theama/contracts'

export type SetupStatus = 'configured' | 'attention' | 'not_configured' | 'skipped' | 'unavailable'
export function withSkip(status: SetupStatus, skipped: boolean): SetupStatus {
  return skipped && status === 'not_configured' ? 'skipped' : status
}
export function clientStatus(state: DownloadClientState | undefined): SetupStatus {
  return state === undefined ? 'unavailable' : state === 'connected' ? 'configured' : state === 'not_configured' ? 'not_configured' : 'attention'
}
export function metadataStatus(status: MetadataStatus | null, connected: boolean): SetupStatus {
  if (!connected || !status) return 'unavailable'
  if (!status.configured) return 'not_configured'
  return status.state === 'idle' || status.state === 'working' ? 'configured' : 'attention'
}
export function libraryStatus(sources: LibrarySource[], loaded: boolean, connected: boolean): SetupStatus {
  if (!connected || !loaded) return 'unavailable'
  if (!sources.length) return 'not_configured'
  if (sources.some((s) => s.availability === 'offline')) return 'attention'
  return sources.some((s) => s.availability === 'unknown') ? 'unavailable' : 'configured'
}
export function playerStatus(player: PlayerInfo | null, loaded: boolean): SetupStatus {
  if (!loaded) return 'unavailable'
  if (!player) return 'not_configured'
  // The system association is not probed, even though Windows offers the fallback.
  if (player.kind === 'system') return 'unavailable'
  return player.available ? 'configured' : 'attention'
}
