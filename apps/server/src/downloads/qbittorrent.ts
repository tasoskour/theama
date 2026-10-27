export type DownloadClientErrorKind = 'unreachable' | 'auth' | 'forbidden' | 'unavailable'

export class DownloadClientError extends Error {
  constructor(
    readonly kind: DownloadClientErrorKind,
    message: string,
    /** The HTTP status qBittorrent answered with, when it did. */
    readonly httpStatus?: number,
  ) {
    super(message)
    this.name = 'DownloadClientError'
  }
}

type Form = URLSearchParams | FormData

export interface QBittorrentConnection {
  /** The Web UI address, e.g. `http://localhost:8080`. */
  url: string
  username: string
  password: string
}

export interface QBittorrentSearchHit {
  title: string
  link: string
  size: number
  seeders: number
  leechers: number
  /** The site a plugin searched, e.g. `https://thepiratebay.org`. */
  site: string | null
}

/** The fields of qBittorrent's `torrents/info` that Theama uses. */
export interface QBittorrentTorrent {
  hash: string
  name: string
  state: string
  progress: number
  dlspeed: number
  size: number
  eta: number
  tags: string
  addedOn: number
}

export interface QBittorrentFile {
  index: number
  name: string
  size: number
  progress: number
  /** 0 = do not download; 1 normal; 6 high; 7 maximal. */
  priority: number
}

export interface QBittorrentOptions {
  fetch?: typeof fetch
  timeoutMs?: number
}

/**
 * A thin client for the qBittorrent Web API (v2). It logs in lazily, keeps the session cookie, and logs in
 * again once if the session has expired. qBittorrent refuses requests whose Origin/Referer do not match its own
 * host (its CSRF check), so both are sent.
 *
 * Stateless apart from the cookie: the connection is read on every call so a changed password applies at once.
 */
export class QBittorrentClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeout: number
  private sid: string | null = null
  private sidFor = ''

  constructor(
    private readonly connection: () => QBittorrentConnection | null,
    options: QBittorrentOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch
    this.timeout = options.timeoutMs ?? 10_000
  }

  /** `v5.0.1` */
  version(): Promise<string> {
    return this.text('GET', '/api/v2/app/version')
  }

  /** `2.11.2` */
  webApiVersion(): Promise<string> {
    return this.text('GET', '/api/v2/app/webapiVersion')
  }

  /** Queues a magnet link or .torrent address. qBittorrent says "Ok." or "Fails." (a 200 either way). */
  async add(link: string, options: { savePath?: string | null; tags?: string[] } = {}): Promise<void> {
    const form = new FormData()
    form.set('urls', link)
    if (options.savePath) form.set('savepath', options.savePath)
    if (options.tags?.length) form.set('tags', options.tags.join(','))
    const answer = await this.text('POST', '/api/v2/torrents/add', form)
    if (answer === 'Fails.') throw new DownloadClientError('unavailable', 'qBittorrent could not add this torrent')
  }

  /** Torrents carrying a tag (or just these hashes). Wrong-shaped entries are skipped rather than failing the list. */
  async torrents(filter: { tag?: string; hashes?: string[] } = {}): Promise<QBittorrentTorrent[]> {
    const params = new URLSearchParams()
    if (filter.tag) params.set('tag', filter.tag)
    if (filter.hashes) params.set('hashes', filter.hashes.join('|'))
    const raw = JSON.parse(await this.text('GET', `/api/v2/torrents/info?${params}`)) as unknown
    if (!Array.isArray(raw)) throw new DownloadClientError('unavailable', 'qBittorrent sent an unexpected answer')
    return raw.flatMap((t: Record<string, unknown>) =>
      typeof t.hash === 'string' && typeof t.name === 'string'
        ? [
            {
              hash: t.hash.toLowerCase(),
              name: t.name,
              state: String(t.state ?? ''),
              progress: Math.min(1, Math.max(0, Number(t.progress) || 0)),
              dlspeed: Math.max(0, Number(t.dlspeed) || 0),
              size: Math.max(0, Number(t.total_size) || Number(t.size) || 0),
              eta: Number.isFinite(Number(t.eta)) ? Number(t.eta) : 8640000,
              tags: typeof t.tags === 'string' ? t.tags : '',
              addedOn: Math.max(0, Number(t.added_on) || 0),
            },
          ]
        : [],
    )
  }

  /** The files in a torrent. Empty while a magnet link's details are still being fetched. */
  async files(hash: string): Promise<QBittorrentFile[]> {
    const raw = JSON.parse(await this.text('GET', `/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`)) as unknown
    if (!Array.isArray(raw)) throw new DownloadClientError('unavailable', 'qBittorrent sent an unexpected answer')
    return raw.flatMap((f: Record<string, unknown>, position) =>
      typeof f.name === 'string'
        ? [
            {
              // Older versions do not number the files; their order is the numbering.
              index: Number.isInteger(f.index) ? (f.index as number) : position,
              name: f.name,
              size: Math.max(0, Number(f.size) || 0),
              progress: Math.min(1, Math.max(0, Number(f.progress) || 0)),
              priority: Number(f.priority) || 0,
            },
          ]
        : [],
    )
  }

  /** Sets how much these files matter: 0 skips them, 1 is normal. */
  async setFilePriority(hash: string, indexes: number[], priority: 0 | 1): Promise<void> {
    if (indexes.length === 0) return
    await this.send('POST', '/api/v2/torrents/filePrio', new URLSearchParams({ hash, id: indexes.join('|'), priority: String(priority) }))
  }

  /** qBittorrent 5 calls these stop/start, 4.x pause/resume; the other name answers 404. */
  async setPaused(hashes: string[], paused: boolean): Promise<void> {
    const form = () => new URLSearchParams({ hashes: hashes.join('|') })
    const [now, before] = paused ? ['stop', 'pause'] : ['start', 'resume']
    try {
      await this.send('POST', `/api/v2/torrents/${now}`, form())
    } catch (err) {
      if (!(err instanceof DownloadClientError) || err.httpStatus !== 404) throw err
      await this.send('POST', `/api/v2/torrents/${before}`, form())
    }
  }

  async remove(hashes: string[], deleteFiles: boolean): Promise<void> {
    await this.send('POST', '/api/v2/torrents/delete', new URLSearchParams({ hashes: hashes.join('|'), deleteFiles: String(deleteFiles) }))
  }

  /**
   * Runs qBittorrent's own search plugins and waits for them (up to `timeoutMs`; slow sites are cut off rather than
   * waited for). The search is always stopped and deleted afterwards: qBittorrent allows only five at a time.
   */
  async search(pattern: string, timeoutMs = 12_000): Promise<QBittorrentSearchHit[]> {
    const plugins = JSON.parse(await this.text('GET', '/api/v2/search/plugins')) as { enabled?: boolean }[]
    if (!plugins.some((p) => p.enabled)) {
      throw new DownloadClientError('unavailable', 'qBittorrent has no search plugins enabled (Search tab → Search plugins)')
    }
    const started = await this.send('POST', '/api/v2/search/start', new URLSearchParams({ pattern, plugins: 'enabled', category: 'all' }))
    const { id } = (await started.json()) as { id: number }
    const idForm = () => new URLSearchParams({ id: String(id) })
    try {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const status = JSON.parse(await this.text('GET', `/api/v2/search/status?id=${id}`)) as { status?: string }[]
        if (status[0]?.status !== 'Running' || Date.now() >= deadline) break
        await new Promise((r) => setTimeout(r, 750))
      }
      const raw = JSON.parse(await this.text('GET', `/api/v2/search/results?id=${id}&limit=500`)) as { results?: Record<string, unknown>[] }
      return (raw.results ?? []).flatMap((r) =>
        typeof r.fileName === 'string' && typeof r.fileUrl === 'string'
          ? [
              {
                title: r.fileName,
                link: r.fileUrl,
                size: Math.max(0, Number(r.fileSize) || 0),
                seeders: Math.max(0, Number(r.nbSeeders) || 0),
                leechers: Math.max(0, Number(r.nbLeechers) || 0),
                site: typeof r.siteUrl === 'string' ? r.siteUrl : null,
              },
            ]
          : [],
      )
    } finally {
      await this.send('POST', '/api/v2/search/stop', idForm()).catch(() => undefined)
      await this.send('POST', '/api/v2/search/delete', idForm()).catch(() => undefined)
    }
  }

  private async text(method: 'GET' | 'POST', path: string, form?: Form): Promise<string> {
    const res = await this.send(method, path, form)
    return (await res.text()).trim()
  }

  private async send(method: 'GET' | 'POST', path: string, form?: Form, retried = false): Promise<Response> {
    const conn = this.connection()
    if (!conn) throw new DownloadClientError('unavailable', 'qBittorrent is not set up')
    const base = baseOf(conn.url)
    // A different server or user means the old session is not ours any more.
    const identity = `${base}|${conn.username}|${conn.password}`
    if (this.sidFor !== identity) {
      this.sid = null
      this.sidFor = identity
    }
    // No user name and password: qBittorrent is set to skip authentication for this machine (localhost or a
    // whitelisted subnet), so there is nothing to log in with and the requests go out as they are.
    const anonymous = !conn.username && !conn.password
    if (this.sid === null) {
      if (anonymous) this.sid = ''
      else await this.login(base, conn)
    }
    const res = await this.raw(base, method, path, form, this.sid ? { Cookie: this.sid } : {})
    if (anonymous && (res.status === 401 || res.status === 403)) {
      await res.body?.cancel().catch(() => undefined)
      throw new DownloadClientError('auth', 'qBittorrent asks for a user name and password from this machine')
    }
    if (res.status === 403 && !retried) {
      // The session expired (qBittorrent restarted or timed out): log in once more.
      this.sid = null
      await res.body?.cancel().catch(() => undefined)
      return this.send(method, path, form, true)
    }
    if (res.status === 403) {
      const session = this.sid ? 'a session cookie was sent' : 'no session cookie was received at login'
      throw new DownloadClientError('forbidden', `qBittorrent refused the request (${session}; is this machine banned or the host not allowed?)`)
    }
    if (!res.ok) throw new DownloadClientError('unavailable', `qBittorrent answered HTTP ${res.status}`, res.status)
    return res
  }

  private async login(base: string, conn: QBittorrentConnection): Promise<void> {
    const res = await this.raw(base, 'POST', '/api/v2/auth/login', new URLSearchParams({ username: conn.username, password: conn.password }), {})
    if (res.status === 403) {
      throw new DownloadClientError('forbidden', 'qBittorrent has banned this machine after too many failed logins; wait or restart qBittorrent')
    }
    // Some builds and reverse proxies answer a failed login with 401 instead of a 200 "Fails.".
    if (res.status === 401) throw new DownloadClientError('auth', 'qBittorrent did not accept the user name or password')
    if (!res.ok) throw new DownloadClientError('unavailable', `qBittorrent answered HTTP ${res.status}`)
    // Wrong credentials are a 200 with the body "Fails.", not an error status.
    const body = (await res.text()).trim()
    if (body !== 'Ok.') throw new DownloadClientError('auth', 'qBittorrent did not accept the user name or password')
    // With "bypass authentication for localhost" there is no cookie and none is needed.
    this.sid = sessionCookie(res.headers.getSetCookie())
  }

  private async raw(base: string, method: 'GET' | 'POST', path: string, form: Form | undefined, headers: Record<string, string>): Promise<Response> {
    try {
      return await this.fetchImpl(new URL(path.slice(1), base), {
        method,
        headers: { Referer: base, Origin: new URL(base).origin, ...headers },
        ...(form ? { body: form } : {}),
        signal: AbortSignal.timeout(this.timeout),
        redirect: 'error',
      })
    } catch (err) {
      const reason = err instanceof Error ? (err.name === 'TimeoutError' ? 'timed out' : withCause(err)) : 'network error'
      throw new DownloadClientError('unreachable', `Could not reach qBittorrent at ${base} (${reason})`)
    }
  }
}

/** Node's fetch only says "fetch failed"; the refused connection, bad certificate or redirect is in `cause`. */
function withCause(err: Error): string {
  const cause = err.cause
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code
    return `${err.message}: ${code ? `${code} ` : ''}${cause.message}`
  }
  return err.message
}

/**
 * The `name=value` pair to send back. qBittorrent names its session cookie `SID`, newer builds `QBT_SID_<port>`; a
 * proxy may rename it again, so fall back to the first cookie set. No cookie means authentication is bypassed.
 */
function sessionCookie(setCookies: string[]): string {
  const pairs = setCookies.map((c) => c.split(';')[0]?.trim() ?? '').filter((p) => p.includes('='))
  return pairs.find((p) => /^(QBT_)?SID(_\d+)?=/i.test(p)) ?? pairs[0] ?? ''
}

/** `http://host:8080` ->`http://host:8080/`; a reverse-proxy path prefix is kept so endpoints resolve under it. */
export function baseOf(url: string): string {
  const u = new URL(url)
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}/`
}
