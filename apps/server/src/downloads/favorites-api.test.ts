import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { FavoriteList, FavoriteTitle, LibraryIdentities, ServerEvent } from '@theama/contracts'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'

let dir: string
let server: RunningServer
let base: string
let config: ReturnType<typeof loadConfig>
const movie = { provider: 'tmdb', kind: 'movie', externalId: '42', title: 'Saved movie', originalTitle: null, year: 2026, overview: 'Saved description', posterUrl: null, score: null, genres: ['Drama'], rating: 8 }
const send = (method: string, path: string, body?: unknown) => fetch(`${base}${path}`, {
  method, headers: { Authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const list = async () => FavoriteList.parse(await (await send('GET', '/downloads/favorites')).json()).items

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'theama-favorites-api-'))
  config = loadConfig({ THEAMA_DATA_DIR: join(dir, 'data'), THEAMA_PORT: '0', THEAMA_FFPROBE: 'none' })
  server = await startServer(config)
  base = `http://127.0.0.1:${server.port}/api/v1`
})
afterAll(async () => {
  await server?.stop('test finished')
  const child = relative(tmpdir(), dir)
  if (isAbsolute(child) || !/^theama-favorites-api-[^\\/]+$/.test(child)) throw new Error('Unexpected temporary directory')
  await rm(dir, { recursive: true, force: true })
})

describe('favorites API without metadata credentials', () => {
  it('validates requests and keeps endpoints authenticated', async () => {
    expect((await fetch(`${base}/downloads/favorites`)).status).toBe(401)
    expect((await send('PUT', '/downloads/favorites', { ...movie, kind: 'video' })).status).toBe(400)
    expect((await send('PUT', '/downloads/favorites', { ...movie, title: '' })).status).toBe(400)
    expect(await list()).toEqual([])
    expect(LibraryIdentities.parse(await (await send('GET', '/library/title-identities')).json())).toEqual({ items: [] })
  })

  it('broadcasts saves and removals, deduplicates identities and survives server restart', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/events`, { headers: { Authorization: `Bearer ${server.token}` } })
    const events: string[] = []
    socket.on('message', (data) => { events.push(ServerEvent.parse(JSON.parse(String(data))).type) })
    try {
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
      const saved = FavoriteTitle.parse(await (await send('PUT', '/downloads/favorites', movie)).json())
      expect(FavoriteTitle.parse(await (await send('PUT', '/downloads/favorites', movie)).json())).toEqual(saved)
      await send('PUT', '/downloads/favorites', { ...movie, kind: 'series' })
      expect(await list()).toHaveLength(2)
      expect(await (await send('DELETE', '/downloads/favorites/tmdb/series/42')).json()).toEqual({ deleted: true })
      expect(await (await send('DELETE', '/downloads/favorites/tmdb/series/42')).json()).toEqual({ deleted: false })
      await expect.poll(() => events.filter((type) => type === 'favorites.changed').length).toBe(5)
      socket.close()
      await new Promise<void>((resolve) => socket.once('close', () => resolve()))
      await server.stop('restart test')
      server = await startServer(config)
      base = `http://127.0.0.1:${server.port}/api/v1`
      expect(await list()).toEqual([saved])
    } finally { socket.terminate() }
  })
})
