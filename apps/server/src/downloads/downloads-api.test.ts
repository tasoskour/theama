import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DownloadClientStatus } from '@theama/contracts'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'

/** Just enough of qBittorrent's Web API: form login with a SID cookie, and the version endpoints. */
function startFakeQBittorrent(): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const origin = `http://${req.headers.host}`
    // qBittorrent's CSRF check: the Origin has to be its own.
    if (req.headers.origin !== origin) return void res.writeHead(401).end()
    if (req.url === '/api/v2/auth/login') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const form = new URLSearchParams(body)
        if (form.get('username') === 'admin' && form.get('password') === 'adminadmin') {
          res.writeHead(200, { 'Set-Cookie': 'SID=s3ssion; HttpOnly; path=/' }).end('Ok.')
        } else {
          res.writeHead(200).end('Fails.')
        }
      })
      return
    }
    if (req.headers.cookie !== 'SID=s3ssion') return void res.writeHead(403).end('Forbidden')
    if (req.url === '/api/v2/app/version') return void res.writeHead(200).end('v5.0.1')
    if (req.url === '/api/v2/app/webapiVersion') return void res.writeHead(200).end('2.11.2')
    res.writeHead(404).end()
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => new Promise((r) => server.close(() => r())),
      }),
    ),
  )
}

let dir: string
let server: RunningServer
let fake: Awaited<ReturnType<typeof startFakeQBittorrent>>
let base: string
let secretFile: string
const send = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const put = (password: string, url = fake.url) => send('PUT', '/downloads/client', { qbittorrent: { url, username: 'admin', password } })

beforeAll(async () => {
  fake = await startFakeQBittorrent()
  dir = mkdtempSync(join(tmpdir(), 'theama-downloads-api-'))
  const config = loadConfig({ THEAMA_DATA_DIR: join(dir, 'data'), THEAMA_PORT: '0', THEAMA_FFPROBE: 'none' })
  secretFile = config.downloadClientFile
  server = await startServer(config)
  base = `http://127.0.0.1:${server.port}/api/v1`
})
afterAll(async () => {
  await server.stop('test finished')
  await fake.close()
  await rm(dir, { recursive: true, force: true })
})

describe('qBittorrent connection', () => {
  it('starts not configured', async () => {
    const res = await send('GET', '/downloads/status')
    expect(DownloadClientStatus.parse(await res.json())).toMatchObject({ state: 'not_configured' })
  })

  it('rejects a wrong password with a 400 and stores nothing', async () => {
    const res = await put('wrong')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_credentials')
    expect(existsSync(secretFile)).toBe(false)
  })

  it('rejects an address that is not http(s)', async () => {
    expect((await put('adminadmin', 'ftp://localhost')).status).toBe(400)
    expect((await put('adminadmin', 'not a url')).status).toBe(400)
  })

  it('saves a working connection, keeps the password in the secrets folder and never returns it', async () => {
    const res = await put('adminadmin')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).not.toContain('adminadmin')
    expect(DownloadClientStatus.parse(JSON.parse(body))).toMatchObject({ state: 'connected', version: 'v5.0.1', webApiVersion: '2.11.2', username: 'admin' })
    expect(readFileSync(secretFile, 'utf8')).toContain('adminadmin')
    const status = await (await send('GET', '/downloads/status')).text()
    expect(status).not.toContain('adminadmin')
    expect(JSON.parse(status)).toMatchObject({ state: 'connected' })
  })

  it('reports an unreachable qBittorrent instead of failing', async () => {
    await fake.close()
    const res = await send('GET', '/downloads/status')
    expect(res.status).toBe(200)
    expect(DownloadClientStatus.parse(await res.json())).toMatchObject({ state: 'unreachable' })
  })

  it('forgets the connection', async () => {
    const res = await send('PUT', '/downloads/client', { qbittorrent: null })
    expect(DownloadClientStatus.parse(await res.json())).toMatchObject({ state: 'not_configured' })
    expect(existsSync(secretFile)).toBe(false)
  })
})
