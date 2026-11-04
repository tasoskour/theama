import { z } from 'zod'

/** The address of the qBittorrent Web UI, e.g. `http://localhost:8080`. Only http and https are accepted. */
const ClientUrl = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    try {
      const { protocol } = new URL(value)
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }, 'Must be an http or https address')

export const DownloadClientState = z.enum([
  'not_configured',
  'connected',
  /** Nothing answered at the address (qBittorrent closed, wrong port, Web UI off). */
  'unreachable',
  /** qBittorrent answered but refused the user name or password. */
  'auth_failed',
  /** qBittorrent banned this machine after repeated failed logins, or its host check refused us. */
  'forbidden',
])
export type DownloadClientState = z.infer<typeof DownloadClientState>

/** What the person typed. The password is write-only: it is stored in the secrets folder and never returned. */
export const SetDownloadClientRequest = z.object({
  /** `null` forgets the connection. */
  qbittorrent: z.object({ url: ClientUrl, username: z.string().max(200), password: z.string().max(500) }).nullable(),
})
export type SetDownloadClientRequest = z.infer<typeof SetDownloadClientRequest>

/** What the person typed for Prowlarr. The API key is write-only, like the qBittorrent password. */
export const SetIndexerRequest = z.object({
  /** `null` forgets the connection. */
  prowlarr: z.object({ url: ClientUrl, apiKey: z.string().trim().min(8).max(200) }).nullable(),
})
export type SetIndexerRequest = z.infer<typeof SetIndexerRequest>

export const IndexerStatus = z.object({
  state: DownloadClientState,
  url: z.string().nullable(),
  version: z.string().nullable(),
  message: z.string().nullable(),
})
export type IndexerStatus = z.infer<typeof IndexerStatus>

export const ReleaseKind = z.enum(['movie', 'series'])
export type ReleaseKind = z.infer<typeof ReleaseKind>

/** Prowlarr searches the configured torrent indexers. */
export const ReleaseSource = z.literal('prowlarr')
export type ReleaseSource = z.infer<typeof ReleaseSource>

export const ReleaseQuery = z.object({
  kind: ReleaseKind,
  title: z.string().trim().min(1).max(200),
  year: z.coerce.number().int().min(1870).max(2200).optional(),
  /** Series only. Without an episode this asks for the whole season (or any season when it is absent too). */
  season: z.coerce.number().int().min(0).max(99).optional(),
  episode: z.coerce.number().int().min(0).max(999).optional(),
  sort: z.enum(['quality', 'seeders']).optional(),
  collectionName: z.string().trim().min(1).max(200).optional(),
  /** Keeps results whose name does not look like the title asked for. Sent as `unmatched=true`; anything else is ignored. */
  unmatched: z.enum(['true']).transform(() => true as const).optional(),
})
export type ReleaseQuery = z.infer<typeof ReleaseQuery>

export const Resolution = z.enum(['2160p', '1080p', '720p', '480p'])
export type Resolution = z.infer<typeof Resolution>

/** One torrent that could be downloaded. `id` is opaque: the server remembers where it came from. */
export const Release = z.object({
  id: z.string(),
  title: z.string(),
  /** Bytes; 0 when the source did not say. */
  size: z.number().int().min(0),
  seeders: z.number().int().min(0),
  leechers: z.number().int().min(0),
  /** The tracker or site the release was found on. */
  indexer: z.string().nullable(),
  resolution: Resolution.nullable(),
  /** `BluRay`, `WEB-DL`, `HDTV`, … */
  quality: z.string().nullable(),
  codec: z.string().nullable(),
  season: z.number().int().nullable(),
  episode: z.number().int().nullable(),
  /** A whole season (or series) rather than one episode. */
  pack: z.boolean(),
  /** The name suggests a multi-movie collection; contents have not been verified. */
  collectionPack: z.boolean().optional(),
})
export type Release = z.infer<typeof Release>

export const ReleaseList = z.object({
  source: ReleaseSource,
  items: z.array(Release),
  /** How many usable results the source sent back before Theama dropped the ones that are not this title. */
  received: z.number().int().min(0),
})
export type ReleaseList = z.infer<typeof ReleaseList>

export const AddDownloadRequest = z.object({
  releaseId: z.string().min(1).max(100),
  kind: ReleaseKind,
})
export type AddDownloadRequest = z.infer<typeof AddDownloadRequest>

export const DownloadClientStatus = z.object({
  state: DownloadClientState,
  url: z.string().nullable(),
  username: z.string().nullable(),
  /** e.g. `v5.0.1`; null while not connected. */
  version: z.string().nullable(),
  webApiVersion: z.string().nullable(),
  message: z.string().nullable(),
})
export type DownloadClientStatus = z.infer<typeof DownloadClientStatus>

/** Simplified from qBittorrent's many torrent states. */
export const DownloadState = z.enum(['metadata', 'downloading', 'stalled', 'queued', 'checking', 'paused', 'completed', 'error'])
export type DownloadState = z.infer<typeof DownloadState>

/** One torrent in qBittorrent: normally one Theama added (it carries the `theama` tag), or any, when the person turned on managing all. */
export const DownloadItem = z.object({
  /** The torrent's info hash, which qBittorrent identifies it by. */
  hash: z.string(),
  name: z.string(),
  state: DownloadState,
  /** 0–1 */
  progress: z.number().min(0).max(1),
  /** Bytes per second. */
  downloadSpeed: z.number().min(0),
  /** Bytes. */
  size: z.number().min(0),
  /** Seconds left; null when unknown or not moving. */
  eta: z.number().int().min(0).nullable(),
  kind: ReleaseKind.nullable(),
  /** Added by Theama (carries its tag). False only for the person's other torrents. */
  own: z.boolean(),
  addedAt: z.string().nullable(),
  /** qBittorrent's own words for why a torrent in the `error` state stopped (e.g. "Access is denied"), when its log says. */
  problem: z.string().nullable().optional(),
})
export type DownloadItem = z.infer<typeof DownloadItem>

export const DownloadList = z.object({
  /** False when qBittorrent is not set up or did not answer; `items` is then empty. */
  reachable: z.boolean(),
  items: z.array(DownloadItem),
})
export type DownloadList = z.infer<typeof DownloadList>

/** One file inside a torrent. */
export const DownloadFile = z.object({
  /** Position in the torrent, which qBittorrent addresses files by. */
  index: z.number().int().min(0),
  /** Path inside the torrent, folders included. */
  name: z.string(),
  size: z.number().min(0),
  progress: z.number().min(0).max(1),
  /** False when the file is set to "do not download". */
  wanted: z.boolean(),
})
export type DownloadFile = z.infer<typeof DownloadFile>

/** Empty while qBittorrent is still fetching the torrent's details (a magnet link has no file list yet). */
export const DownloadFileList = z.object({ files: z.array(DownloadFile) })
export type DownloadFileList = z.infer<typeof DownloadFileList>

/** Exactly these files are downloaded; every other file in the torrent is skipped. At least one is needed (remove the download to stop it all). */
export const SetDownloadFilesRequest = z.object({ wanted: z.array(z.number().int().min(0)).min(1).max(20_000) })
export type SetDownloadFilesRequest = z.infer<typeof SetDownloadFilesRequest>
