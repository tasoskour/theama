import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IndexerStatus, ReleaseList } from '@theama/contracts'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'

const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Dune.2021.2160p'

const listen = (server: Server): Promise<string> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))
const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => resolve(body))
  })

/** qBittorrent with one search plugin; records what was added. */
function fakeQBittorrent(opts: { plugins: boolean }) {
  const added: string[] = []
  const stopped: string[] = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x')
    if (url.pathname === '/api/v2/auth/login') {
      await readBody(req)
      return void res.writeHead(200, { 'Set-Cookie': 'SID=ok; path=/' }).end('Ok.')
    }
    if (req.headers.cookie !== 'SID=ok') return void res.writeHead(403).end()
    const body = await readBody(req)
    switch (url.pathname) {
      case '/api/v2/app/version':
        return void res.writeHead(200).end('v5.0.1')
      case '/api/v2/app/webapiVersion':
        return void res.writeHead(200).end('2.11.2')
      case '/api/v2/search/plugins':
        return void res.writeHead(200).end(JSON.stringify(opts.plugins ? [{ name: 'x', enabled: true }] : []))
      case '/api/v2/search/start':
        return void res.writeHead(200).end(JSON.stringify({ id: 7 }))
      case '/api/v2/search/status':
        return void res.writeHead(200).end(JSON.stringify([{ id: 7, status: 'Stopped', total: 3 }]))
      case '/api/v2/search/results':
        return void res.writeHead(200).end(
          JSON.stringify({
            status: 'Stopped',
            total: 3,
            results: [
              { fileName: 'Dune.2021.1080p.BluRay.x264', fileUrl: MAGNET, fileSize: 9e9, nbSeeders: 40, nbLeechers: 2, siteUrl: 'https://site.example' },
              { fileName: 'Dune.Part.Two.2024.1080p', fileUrl: MAGNET, fileSize: 9e9, nbSeeders: 90, nbLeechers: 2, siteUrl: 'https://site.example' },
              { fileName: 'Dune.2021.720p.WEBRip', fileUrl: 'javascript:alert(1)', fileSize: 1e9, nbSeeders: 5, nbLeechers: 0, siteUrl: 'https://site.example' },
            ],
          }),
        )
      case '/api/v2/search/stop':
      case '/api/v2/search/delete':
        stopped.push(url.pathname)
        return void res.writeHead(200).end()
      case '/api/v2/torrents/add':
        added.push(body)
        return void res.writeHead(200).end('Ok.')
    }
    res.writeHead(404).end()
  })
  return { server, added, stopped }
}

/** Prowlarr with a mixed bag of results (a usenet one, a dead link, a good magnet). */
function fakeProwlarr() {
  const queries: string[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    if (req.headers['x-api-key'] !== 'prowlarr-key-123') return void res.writeHead(401).end()
    if (url.pathname === '/api/v1/system/status') return void res.writeHead(200).end(JSON.stringify({ version: '1.30.2' }))
    if (url.pathname === '/api/v1/search') {
      queries.push(url.search)
      return void res.writeHead(200).end(
        JSON.stringify([
          { title: 'Dune.2021.2160p.UHD.BluRay.x265', size: 20e9, seeders: 120, leechers: 10, indexer: 'IdxA', protocol: 'torrent', magnetUrl: MAGNET },
          { title: 'Dune.2021.1080p.WEB-DL', size: 4e9, seeders: 800, leechers: 10, indexer: 'IdxB', protocol: 'torrent', downloadUrl: 'http://prowlarr.local/dl/1' },
          { title: 'Dune.2021.1080p.NZB', size: 4e9, seeders: null, leechers: null, indexer: 'Usenet', protocol: 'usenet', downloadUrl: 'http://prowlarr.local/dl/2' },
          { title: 'Dune.2021.CAM', size: 1e9, seeders: 3, leechers: 0, indexer: 'IdxA', protocol: 'torrent' },
          { title: 'Dune.1984.1080p', size: 4e9, seeders: 50, leechers: 0, indexer: 'IdxA', protocol: 'torrent', magnetUrl: MAGNET },
        ]),
      )
    }
    res.writeHead(404).end()
  })
  return { server, queries }
}

let dir: string
let server: RunningServer
let base: string
let moviesDir: string
const qb = fakeQBittorrent({ plugins: true })
const prowlarr = fakeProwlarr()
let qbUrl: string
let prowlarrUrl: string

const send = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const releases = (query: string) => send('GET', `/downloads/releases?${query}`)

beforeAll(async () => {
  qbUrl = await listen(qb.server)
  prowlarrUrl = await listen(prowlarr.server)
  dir = mkdtempSync(join(tmpdir(), 'theama-releases-'))
  moviesDir = join(dir, 'Movies')
  mkdirSync(moviesDir)
  const config = loadConfig({ THEAMA_DATA_DIR: join(dir, 'data'), THEAMA_PORT: '0', THEAMA_FFPROBE: 'none' })
  server = await startServer(config)
  base = `http://127.0.0.1:${server.port}/api/v1`
})
afterAll(async () => {
  await server.stop('test finished')
  qb.server.close()
  prowlarr.server.close()
  await rm(dir, { recursive: true, force: true })
})

describe('before anything is set up', () => {
  it('says what is missing', async () => {
    const res = await releases('kind=movie&title=Dune')
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_configured')
    expect((await send('POST', '/downloads', { releaseId: 'nope', kind: 'movie' })).status).toBe(409)
  })
})

describe('searching through qBittorrent plugins', () => {
  it('lists only matching, usable releases and cleans up its search', async () => {
    expect((await send('PUT', '/downloads/client', { qbittorrent: { url: qbUrl, username: 'a', password: 'b' } })).status).toBe(200)
    const res = await releases('kind=movie&title=Dune&year=2021')
    expect(res.status).toBe(200)
    const list = ReleaseList.parse(await res.json())
    expect(list.source).toBe('qbittorrent')
    // The sequel and the javascript: link are gone.
    expect(list.items.map((i) => i.title)).toEqual(['Dune.2021.1080p.BluRay.x264'])
    expect(list.items[0]).toMatchObject({ resolution: '1080p', quality: 'BluRay', codec: 'H.264', seeders: 40, indexer: 'https://site.example' })
    expect(qb.stopped).toEqual(['/api/v2/search/stop', '/api/v2/search/delete'])
    // Neither the magnet link nor anything else internal reaches the UI.
    expect(JSON.stringify(list)).not.toContain('magnet:')
  })

  it('keeps releases that do not look like the title when asked, but still never unusable links', async () => {
    expect((await send('PUT', '/downloads/client', { qbittorrent: { url: qbUrl, username: 'a', password: 'b' } })).status).toBe(200)
    const list = ReleaseList.parse(await (await releases('kind=movie&title=Dune&year=2021&unmatched=true')).json())
    const titles = list.items.map((i) => i.title)
    expect(titles).toContain('Dune.2021.1080p.BluRay.x264')
    expect(titles.length).toBeGreaterThan(1)
    expect(JSON.stringify(list)).not.toContain('javascript:')
  })
})

describe('Prowlarr', () => {
  it('refuses a wrong API key and saves a good one', async () => {
    const bad = await send('PUT', '/downloads/indexer', { prowlarr: { url: prowlarrUrl, apiKey: 'wrong-key-1234' } })
    expect(bad.status).toBe(400)
    const ok = await send('PUT', '/downloads/indexer', { prowlarr: { url: prowlarrUrl, apiKey: 'prowlarr-key-123' } })
    expect(IndexerStatus.parse(await ok.json())).toMatchObject({ state: 'connected', version: '1.30.2' })
    expect(JSON.stringify(await (await send('GET', '/downloads/indexer')).json())).not.toContain('prowlarr-key-123')
  })

  it('is preferred, skips usenet and dead links, and ranks by seeders within a resolution', async () => {
    const list = ReleaseList.parse(await (await releases('kind=movie&title=Dune&year=2021')).json())
    expect(list.source).toBe('prowlarr')
    // Better resolution wins over more seeders; usenet, the link-less CAM and the 1984 film are gone.
    expect(list.items.map((i) => i.title)).toEqual(['Dune.2021.2160p.UHD.BluRay.x265', 'Dune.2021.1080p.WEB-DL'])
    expect(prowlarr.queries[0]).toContain('query=Dune+2021')
    expect(prowlarr.queries[0]).not.toContain('categories')
  })

  it('can still be told to use the qBittorrent plugins', async () => {
    const list = ReleaseList.parse(await (await releases('kind=movie&title=Dune&year=2021&source=qbittorrent')).json())
    expect(list.source).toBe('qbittorrent')
  })
})

describe('downloading', () => {
  it('sends the chosen release to qBittorrent with a tag and the movie folder', async () => {
    const src = await send('POST', '/library/sources', { path: moviesDir, libraryType: 'movies' })
    expect(src.status).toBe(201)
    const { id } = (await src.json()) as { id: number }
    await send('PUT', '/settings', { downloadMovieSourceId: id })

    const list = ReleaseList.parse(await (await releases('kind=movie&title=Dune&year=2021')).json())
    const res = await send('POST', '/downloads', { releaseId: list.items[0]!.id, kind: 'movie' })
    expect(res.status).toBe(201)
    expect(qb.added).toHaveLength(1)
    const form = qb.added[0]!
    expect(form).toContain('magnet:?xt=urn:btih:0123456789abcdef')
    expect(form).toContain('theama,theama-movie')
    expect(form).toContain(moviesDir)
  })

  it('refuses an id the server did not hand out, so no arbitrary address is ever fetched', async () => {
    const res = await send('POST', '/downloads', { releaseId: 'http://169.254.169.254/latest', kind: 'movie' })
    expect(res.status).toBe(410)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('release_expired')
    expect(qb.added).toHaveLength(1)
  })
})

describe('qBittorrent without search plugins', () => {
  it('explains what to enable', async () => {
    const bare = fakeQBittorrent({ plugins: false })
    const url = await listen(bare.server)
    await send('PUT', '/downloads/indexer', { prowlarr: null })
    await send('PUT', '/downloads/client', { qbittorrent: { url, username: 'a', password: 'b' } })
    const res = await releases('kind=movie&title=Dune')
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/search plugins/)
    bare.server.close()
  })
})
