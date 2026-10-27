import { z } from 'zod'
import { DownloadClientError, baseOf, type QBittorrentOptions } from './qbittorrent'

export interface ProwlarrConnection {
  /** e.g. `http://localhost:9696` */
  url: string
  apiKey: string
}

/** A search hit as the indexer reported it. `link` is a magnet link or a .torrent address, never shown to the UI. */
export interface IndexerHit {
  title: string
  size: number
  seeders: number
  leechers: number
  indexer: string | null
  link: string
}

const SystemStatus = z.object({ version: z.string() })

const num = z.number().nullish().transform((v) => (v && v > 0 ? Math.round(v) : 0))
const SearchHit = z.object({
  title: z.string(),
  size: num,
  seeders: num,
  leechers: num,
  indexer: z.string().nullish(),
  protocol: z.string().nullish(),
  magnetUrl: z.string().nullish(),
  downloadUrl: z.string().nullish(),
})

/** Prowlarr's v1 API: one JSON search across every indexer the person configured there. */
export class ProwlarrClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeout: number

  constructor(
    private readonly connection: () => ProwlarrConnection | null,
    options: QBittorrentOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch
    this.timeout = options.timeoutMs ?? 10_000
  }

  async version(): Promise<string> {
    return SystemStatus.parse(await this.getJson('api/v1/system/status')).version
  }

  /**
   * Searches torrent indexers only, in every category: a category filter hides releases an indexer files oddly (an
   * animated show under "Other", say), and what is not the title asked for is dropped by the caller anyway.
   * Indexers can be slow, so this has a longer timeout than a status call.
   */
  async search(query: string): Promise<IndexerHit[]> {
    const params = new URLSearchParams({ query, type: 'search', limit: '100' })
    const raw = await this.getJson(`api/v1/search?${params}`, Math.max(this.timeout, 30_000))
    if (!Array.isArray(raw)) throw new DownloadClientError('unavailable', 'Prowlarr sent an unexpected answer')
    const hits: IndexerHit[] = []
    for (const item of raw) {
      const parsed = SearchHit.safeParse(item)
      if (!parsed.success) continue
      const h = parsed.data
      if (h.protocol && h.protocol !== 'torrent') continue
      const link = h.magnetUrl || h.downloadUrl
      if (!link || !isDownloadLink(link)) continue
      hits.push({ title: h.title, size: h.size, seeders: h.seeders, leechers: h.leechers, indexer: h.indexer ?? null, link })
    }
    return hits
  }

  private async getJson(path: string, timeoutMs = this.timeout): Promise<unknown> {
    const conn = this.connection()
    if (!conn) throw new DownloadClientError('unavailable', 'Prowlarr is not set up')
    let res: Response
    try {
      res = await this.fetchImpl(new URL(path, baseOf(conn.url)), {
        headers: { 'X-Api-Key': conn.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      })
    } catch (err) {
      const reason = err instanceof Error ? (err.name === 'TimeoutError' ? 'timed out' : err.message) : 'network error'
      throw new DownloadClientError('unreachable', `Could not reach Prowlarr at ${conn.url} (${reason})`)
    }
    if (res.status === 401 || res.status === 403) throw new DownloadClientError('auth', 'Prowlarr did not accept the API key')
    if (!res.ok) throw new DownloadClientError('unavailable', `Prowlarr answered HTTP ${res.status}`)
    try {
      return await res.json()
    } catch {
      throw new DownloadClientError('unavailable', 'Prowlarr sent an unreadable answer (is the address a Prowlarr one?)')
    }
  }
}

/** Only magnet links and http(s) addresses are ever handed to qBittorrent. */
export function isDownloadLink(link: string): boolean {
  if (link.startsWith('magnet:?')) return true
  try {
    const { protocol } = new URL(link)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
