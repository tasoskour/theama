import type { DownloadItem, DownloadState } from '@theama/contracts'
import type { QBittorrentTorrent } from './qbittorrent'

/** qBittorrent uses 8640000 seconds (100 days) for "never". */
const ETA_NEVER = 8_640_000

/** Folds qBittorrent's many torrent states into the few a person cares about. */
export function stateOf(torrent: Pick<QBittorrentTorrent, 'state' | 'progress'>): DownloadState {
  const s = torrent.state
  if (s === 'error' || s === 'missingFiles') return 'error'
  // Seeding, or stopped after finishing: the file is all there.
  if (torrent.progress >= 1) return s.startsWith('checking') || s === 'moving' ? 'checking' : 'completed'
  if (s.startsWith('paused') || s.startsWith('stopped')) return 'paused'
  if (s.startsWith('checking') || s === 'allocating' || s === 'moving') return 'checking'
  if (s.startsWith('queued')) return 'queued'
  if (s.startsWith('stalled')) return 'stalled'
  if (s === 'metaDL' || s === 'forcedMetaDL') return 'metadata'
  if (s === 'downloading' || s === 'forcedDL') return 'downloading'
  return 'queued'
}

export function toItem(torrent: QBittorrentTorrent, tag: string): DownloadItem {
  const tags = torrent.tags.split(',').map((t) => t.trim())
  const kind = tags.includes(`${tag}-movie`) ? 'movie' : tags.includes(`${tag}-series`) ? 'series' : null
  const state = stateOf(torrent)
  return {
    hash: torrent.hash,
    name: torrent.name,
    state,
    progress: torrent.progress,
    downloadSpeed: state === 'downloading' ? torrent.dlspeed : 0,
    size: torrent.size,
    eta: state === 'downloading' && torrent.eta >= 0 && torrent.eta < ETA_NEVER ? Math.round(torrent.eta) : null,
    kind,
    own: tags.includes(tag),
    addedAt: torrent.addedOn > 0 ? new Date(torrent.addedOn * 1000).toISOString() : null,
  }
}
