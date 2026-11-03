import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CredentialStore } from '../metadata/credentials'
import { DownloadClientError, QBittorrentClient, baseOf } from './qbittorrent'
import { DownloadsService } from './service'

interface Seen {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

/** A stand-in for qBittorrent's Web API: login by form, a SID cookie, and the two version endpoints. */
function fakeQBittorrent(opts: { user?: string; pass?: string; bypass?: boolean; noContentLogin?: boolean } = {}) {
  const user = opts.user ?? 'admin'
  const pass = opts.pass ?? 'secret-pass'
  const seen: Seen[] = []
  const state = { sid: 'abc123', banned: false, down: false }
  const fetchImpl = (async (input: URL | string, init: RequestInit = {}) => {
    if (state.down) throw new TypeError('fetch failed')
    const url = new URL(input)
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>))
    seen.push({ method: init.method ?? 'GET', url: url.pathname, headers, body: String(init.body ?? '') })
    if (url.pathname.endsWith('/auth/login')) {
      if (state.banned) return new Response('Forbidden', { status: 403 })
      const form = new URLSearchParams(String(init.body))
      if (form.get('username') === user && form.get('password') === pass) {
        const res = opts.noContentLogin ? new Response(null, { status: 204 }) : new Response('Ok.', { status: 200 })
        if (!opts.bypass) res.headers.append('set-cookie', `SID=${state.sid}; HttpOnly; path=/`)
        return res
      }
      return new Response('Fails.', { status: 200 })
    }
    const authed = opts.bypass || headers.Cookie === `SID=${state.sid}`
    if (!authed) return new Response('Forbidden', { status: 403 })
    if (url.pathname.endsWith('/app/version')) return new Response('v5.0.1')
    if (url.pathname.endsWith('/app/webapiVersion')) return new Response('2.11.2')
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { fetch: fetchImpl, seen, state }
}

const conn = { url: 'http://localhost:8080', username: 'admin', password: 'secret-pass' }

describe('QBittorrentClient', () => {
  it('logs in once, keeps the session and sends the Origin and Referer qBittorrent insists on', async () => {
    const fake = fakeQBittorrent()
    const client = new QBittorrentClient(() => conn, { fetch: fake.fetch })
    expect(await client.version()).toBe('v5.0.1')
    expect(await client.webApiVersion()).toBe('2.11.2')
    expect(fake.seen.filter((r) => r.url.endsWith('/auth/login'))).toHaveLength(1)
    expect(fake.seen[0]?.headers).toMatchObject({ Origin: 'http://localhost:8080', Referer: 'http://localhost:8080/' })
    expect(fake.seen[1]?.headers.Cookie).toBe('SID=abc123')
  })

  it('accepts a 204 login response with a session cookie', async () => {
    const fake = fakeQBittorrent({ noContentLogin: true })
    const client = new QBittorrentClient(() => conn, { fetch: fake.fetch })
    expect(await client.version()).toBe('v5.0.1')
    expect(fake.seen[1]?.headers.Cookie).toBe('SID=abc123')
  })

  it('logs in again when the session has expired', async () => {
    const fake = fakeQBittorrent()
    const client = new QBittorrentClient(() => conn, { fetch: fake.fetch })
    await client.version()
    fake.state.sid = 'rotated' // qBittorrent restarted: the old cookie is no good
    expect(await client.version()).toBe('v5.0.1')
    expect(fake.seen.filter((r) => r.url.endsWith('/auth/login'))).toHaveLength(2)
  })

  it('works without a cookie when qBittorrent skips authentication for localhost', async () => {
    const fake = fakeQBittorrent({ bypass: true })
    const client = new QBittorrentClient(() => conn, { fetch: fake.fetch })
    expect(await client.version()).toBe('v5.0.1')
    expect(fake.seen.every((r) => r.headers.Cookie === undefined)).toBe(true)
  })

  it('skips the login when no user name or password is set, and says so when qBittorrent still wants one', async () => {
    const open = fakeQBittorrent({ bypass: true })
    const client = new QBittorrentClient(() => ({ ...conn, username: '', password: '' }), { fetch: open.fetch })
    expect(await client.version()).toBe('v5.0.1')
    expect(open.seen.some((r) => r.url.endsWith('/auth/login'))).toBe(false)

    const closed = fakeQBittorrent()
    const anonymous = new QBittorrentClient(() => ({ ...conn, username: '', password: '' }), { fetch: closed.fetch })
    await expect(anonymous.version()).rejects.toMatchObject({ kind: 'auth' })
  })

  it('sends back a session cookie that is not called SID', async () => {
    const seen: Seen[] = []
    const fetchImpl = (async (input: URL | string, init: RequestInit = {}) => {
      const url = new URL(input)
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>))
      seen.push({ method: init.method ?? 'GET', url: url.pathname, headers, body: '' })
      if (url.pathname.endsWith('/auth/login')) {
        const res = new Response('Ok.')
        res.headers.append('set-cookie', 'theme=dark; path=/')
        res.headers.append('set-cookie', 'QBT_SID_8080=xyz; HttpOnly; path=/')
        return res
      }
      return headers.Cookie === 'QBT_SID_8080=xyz' ? new Response('v5.1.0') : new Response('Forbidden', { status: 403 })
    }) as typeof fetch
    const client = new QBittorrentClient(() => conn, { fetch: fetchImpl })
    expect(await client.version()).toBe('v5.1.0')
  })

  it('treats a 401 at login as wrong credentials', async () => {
    const fetchImpl = (async () => new Response('Unauthorized', { status: 401 })) as typeof fetch
    const client = new QBittorrentClient(() => conn, { fetch: fetchImpl })
    await expect(client.version()).rejects.toMatchObject({ kind: 'auth' })
  })

  it('keeps a reverse-proxy path prefix', async () => {
    const fake = fakeQBittorrent()
    const client = new QBittorrentClient(() => ({ ...conn, url: 'https://nas.lan/qbt/' }), { fetch: fake.fetch })
    await client.version()
    expect(fake.seen.map((r) => r.url)).toEqual(['/qbt/api/v2/auth/login', '/qbt/api/v2/app/version'])
    expect(baseOf('http://h:1')).toBe('http://h:1/')
  })

  it('tells wrong credentials, a ban and an unreachable server apart', async () => {
    const fake = fakeQBittorrent()
    const wrong = new QBittorrentClient(() => ({ ...conn, password: 'nope' }), { fetch: fake.fetch })
    await expect(wrong.version()).rejects.toMatchObject({ kind: 'auth' })

    fake.state.banned = true
    const banned = new QBittorrentClient(() => conn, { fetch: fake.fetch })
    await expect(banned.version()).rejects.toMatchObject({ kind: 'forbidden' })

    fake.state.down = true
    const down = new QBittorrentClient(() => conn, { fetch: fake.fetch })
    await expect(down.version()).rejects.toBeInstanceOf(DownloadClientError)
    await expect(down.version()).rejects.toMatchObject({ kind: 'unreachable' })
  })
})

describe('DownloadsService', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theama-downloads-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const service = (fake: ReturnType<typeof fakeQBittorrent>) =>
    new DownloadsService({ store: new CredentialStore(join(dir, 'qbittorrent.json')), indexerStore: new CredentialStore(join(dir, 'prowlarr.json')), logger: pino({ level: 'silent' }), http: { fetch: fake.fetch } })

  it('reports not configured until a connection is saved', async () => {
    const s = service(fakeQBittorrent())
    expect(await s.status()).toMatchObject({ state: 'not_configured', url: null })
  })

  it('saves a working connection and reports the versions without exposing the password', async () => {
    const s = service(fakeQBittorrent())
    const status = await s.connect(conn)
    expect(status).toMatchObject({ state: 'connected', url: conn.url, username: 'admin', version: 'v5.0.1', webApiVersion: '2.11.2' })
    expect(JSON.stringify(status)).not.toContain('secret-pass')
    expect(await s.status()).toMatchObject({ state: 'connected' })
  })

  it('refuses to save credentials qBittorrent rejects and keeps the previous ones', async () => {
    const s = service(fakeQBittorrent())
    await s.connect(conn)
    const bad = await s.connect({ ...conn, password: 'wrong' })
    expect(bad.state).toBe('auth_failed')
    expect(s.connection()?.password).toBe('secret-pass')
  })

  it('saves details while qBittorrent is not running and says it is unreachable', async () => {
    const fake = fakeQBittorrent()
    fake.state.down = true
    const s = service(fake)
    expect((await s.connect(conn)).state).toBe('unreachable')
    expect(s.connection()).toEqual(conn)
    fake.state.down = false
    expect((await s.status()).state).toBe('connected')
  })

  it('forgets the connection', async () => {
    const s = service(fakeQBittorrent())
    await s.connect(conn)
    expect((await s.connect(null)).state).toBe('not_configured')
    expect(s.connection()).toBeNull()
  })
})
