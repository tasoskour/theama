import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { LogPage, ServerEvent, ServiceEventList, SystemInfo } from '@theama/contracts'
import { startServer, type RunningServer } from './bootstrap'
import { loadConfig } from './config'
import { LATEST_SCHEMA_VERSION } from './db/migrations'

let dir: string
let server: RunningServer
let base: string
let runtimeFile: string
const body = async <T = any>(res: Response): Promise<T> => (await res.json()) as T // eslint-disable-line @typescript-eslint/no-explicit-any
const auth = () => ({ Authorization: `Bearer ${server.token}` })

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'theama-api-'))
  const config = loadConfig({ THEAMA_DATA_DIR: dir, THEAMA_PORT: '0', THEAMA_LOG_LEVEL: 'debug', THEAMA_HOST_MODE: 'service' })
  runtimeFile = config.runtimeFile
  server = await startServer(config)
  base = `http://127.0.0.1:${server.port}/api/v1`
})

afterAll(async () => {
  await server.stop('test finished')
  rmSync(dir, { recursive: true, force: true })
})

describe('authentication and request hygiene', () => {
  it('rejects requests without a token', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(401)
    expect((await body(res)).error.code).toBe('unauthorized')
  })

  it('rejects a wrong token', async () => {
    const res = await fetch(`${base}/health`, { headers: { Authorization: 'Bearer nope' } })
    expect(res.status).toBe(401)
  })

  it('answers health with a valid token', async () => {
    const res = await fetch(`${base}/health`, { headers: auth() })
    expect(res.status).toBe(200)
    expect((await body(res)).status).toBe('ok')
  })

  it('rejects a foreign Origin even with a valid token', async () => {
    const res = await fetch(`${base}/health`, { headers: { ...auth(), Origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
  })

  it('rejects non-loopback Host headers (DNS rebinding)', async () => {
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: server.port, path: '/api/v1/health', headers: { Host: 'evil.example', ...auth() } },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        },
      )
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it('answers CORS preflight only for allowed origins', async () => {
    const ok = await fetch(`${base}/settings`, {
      method: 'OPTIONS',
      headers: { Origin: 'app://theama', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization' },
    })
    expect(ok.headers.get('access-control-allow-origin')).toBe('app://theama')
    const bad = await fetch(`${base}/settings`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' },
    })
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('returns a JSON error envelope for unknown routes', async () => {
    const res = await fetch(`${base}/nope`, { headers: auth() })
    expect(res.status).toBe(404)
    expect((await body(res)).error.code).toBe('not_found')
  })
})

describe('system and settings', () => {
  it('reports system info', async () => {
    const info = SystemInfo.parse(await (await fetch(`${base}/system/info`, { headers: auth() })).json())
    expect(info.hostMode).toBe('service')
    expect(info.paths.dataDir).toBe(dir)
    expect(info.schemaVersion).toBe(LATEST_SCHEMA_VERSION)
  })

  it('writes runtime.json while running', () => {
    expect(existsSync(runtimeFile)).toBe(true)
  })

  it('persists settings patches and validates them', async () => {
    const put = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'el' }),
    })
    expect(put.status).toBe(200)
    expect((await body(await fetch(`${base}/settings`, { headers: auth() }))).language).toBe('el')
    const bad = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'fr' }),
    })
    expect(bad.status).toBe(400)
    expect((await body(bad)).error.code).toBe('invalid_request')
  })

  it('persists the visual mode and graphics quality', async () => {
    const put = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ visualMode: 'immersive', graphicsQuality: 'low' }),
    })
    expect(put.status).toBe(200)
    const settings = await body(await fetch(`${base}/settings`, { headers: auth() }))
    expect(settings.visualMode).toBe('immersive')
    expect(settings.graphicsQuality).toBe('low')
    const bad = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ visualMode: 'vr' }),
    })
    expect(bad.status).toBe(400)
  })

  it('persists the backdrop scene settings and keeps classic as the default', async () => {
    const fresh = await body(await fetch(`${base}/settings`, { headers: auth() }))
    expect(fresh.backdropScene).toBe('classic')
    expect(fresh.backdropByGenre).toBe(true)
    const put = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ backdropScene: 'horror', backdropByGenre: false }),
    })
    expect(put.status).toBe(200)
    const settings = await body(await fetch(`${base}/settings`, { headers: auth() }))
    expect(settings.backdropScene).toBe('horror')
    expect(settings.backdropByGenre).toBe(false)
    const bad = await fetch(`${base}/settings`, {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ backdropScene: 'nope' }),
    })
    expect(bad.status).toBe(400)
  })
})

describe('log history', () => {
  it('pages through app logs newest first and filters by level and text', async () => {
    for (let i = 0; i < 5; i++) server.logger.info(`history-probe-${i}`)
    server.logger.error('history-probe-error')

    const page1 = LogPage.parse(await (await fetch(`${base}/logs?limit=3`, { headers: auth() })).json())
    expect(page1.items).toHaveLength(3)
    expect(page1.items[0]!.message).toBe('history-probe-error')
    expect(page1.nextCursor).not.toBeNull()

    const page2 = LogPage.parse(
      await (await fetch(`${base}/logs?limit=3&cursor=${page1.nextCursor}`, { headers: auth() })).json(),
    )
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id)
    const ids = new Set([...page1.items, ...page2.items].map((e) => e.id))
    expect(ids.size).toBe(6)

    const errors = LogPage.parse(await (await fetch(`${base}/logs?level=error`, { headers: auth() })).json())
    expect(errors.items.every((e) => e.level === 'error' || e.level === 'fatal')).toBe(true)

    const search = LogPage.parse(await (await fetch(`${base}/logs?q=probe-3`, { headers: auth() })).json())
    expect(search.items.map((e) => e.message)).toEqual(['history-probe-3'])
  })

  it('records the start in the service event history', async () => {
    const list = ServiceEventList.parse(await (await fetch(`${base}/service/events`, { headers: auth() })).json())
    expect(list.items.map((e) => e.kind)).toContain('start')
  })
})

describe('websocket', () => {
  it('rejects a connection without a token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/events`)
    const code = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.on('error', () => resolve(-1))
    })
    expect(code).toBe(401)
  })

  it('greets and pushes live log entries', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/events`, { headers: auth() })
    const messages: ServerEvent[] = []
    ws.on('message', (data) => messages.push(ServerEvent.parse(JSON.parse(String(data)))))
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', reject)
    })
    await new Promise((r) => setTimeout(r, 50))
    server.logger.warn('live-tail-probe')
    await new Promise((r) => setTimeout(r, 100))
    ws.close()
    expect(messages[0]!.type).toBe('hello')
    expect(messages.some((m) => m.type === 'log.appended' && m.entry.message === 'live-tail-probe')).toBe(true)
  })
})
