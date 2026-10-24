import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DownloadFileList, DownloadList, ScanJobList, type DownloadItem } from '@theama/contracts'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'
import { stateOf, toItem } from './items'
import { DownloadMonitor } from './monitor'

describe('stateOf', () => {
  const s = (state: string, progress = 0.5) => stateOf({ state, progress })
  it('folds qBittorrent states into a few', () => {
    expect(s('downloading')).toBe('downloading')
    expect(s('forcedDL')).toBe('downloading')
    expect(s('metaDL')).toBe('metadata')
    expect(s('forcedMetaDL')).toBe('metadata')
    expect(s('stalledDL')).toBe('stalled')
    expect(s('queuedDL')).toBe('queued')
    expect(s('checkingDL')).toBe('checking')
    expect(s('pausedDL')).toBe('paused')
    expect(s('stoppedDL')).toBe('paused')
    expect(s('error')).toBe('error')
    expect(s('missingFiles')).toBe('error')
  })
  it('calls anything that is fully downloaded completed, whether seeding, stopped or stalled', () => {
    for (const state of ['uploading', 'stalledUP', 'pausedUP', 'stoppedUP', 'queuedUP', 'forcedUP']) expect(s(state, 1)).toBe('completed')
    expect(s('checkingUP', 1)).toBe('checking')
    expect(s('error', 1)).toBe('error')
  })
})

describe('toItem', () => {
  const t = { hash: 'abc', name: 'Dune', state: 'downloading', progress: 0.25, dlspeed: 2e6, size: 8e9, eta: 3000, tags: 'theama, theama-movie', addedOn: 1_700_000_000 }
  it('reads the kind from our tags and hides speed and ETA when nothing is moving', () => {
    expect(toItem(t, 'theama')).toMatchObject({ kind: 'movie', state: 'downloading', downloadSpeed: 2e6, eta: 3000, addedAt: '2023-11-14T22:13:20.000Z' })
    expect(toItem({ ...t, tags: 'theama,theama-series' }, 'theama').kind).toBe('series')
    expect(toItem({ ...t, tags: 'theama' }, 'theama').kind).toBeNull()
    expect(toItem(t, 'theama').own).toBe(true)
    expect(toItem({ ...t, tags: 'my-own-tag' }, 'theama')).toMatchObject({ own: false, kind: null })
    expect(toItem({ ...t, eta: 8_640_000 }, 'theama').eta).toBeNull()
    expect(toItem({ ...t, state: 'pausedDL' }, 'theama')).toMatchObject({ downloadSpeed: 0, eta: null })
  })
})

describe('DownloadMonitor', () => {
  const item = (hash: string, state: DownloadItem['state']): DownloadItem => ({
    hash, name: hash, state, progress: state === 'completed' ? 1 : 0.4, downloadSpeed: 0, size: 1, eta: null, kind: 'movie', own: true, addedAt: null,
  })
  function setup(initial: DownloadItem[]) {
    const state = { list: { reachable: true, items: initial } as DownloadList }
    const emitted: DownloadList[] = []
    const finished: string[] = []
    const monitor = new DownloadMonitor({
      list: async () => state.list,
      emit: (l) => emitted.push(l),
      onFinished: (i) => finished.push(i.hash),
      watched: () => false,
      logger: pino({ level: 'silent' }),
    })
    return { state, emitted, finished, monitor }
  }

  it('pushes the list only when it changes', async () => {
    const { state, emitted, monitor } = setup([item('a', 'downloading')])
    await monitor.tick()
    await monitor.tick()
    expect(emitted).toHaveLength(1)
    state.list = { reachable: true, items: [item('a', 'paused')] }
    await monitor.tick()
    expect(emitted).toHaveLength(2)
  })

  it('notices a download that finishes, once', async () => {
    const { state, finished, monitor } = setup([item('a', 'downloading')])
    await monitor.tick()
    state.list = { reachable: true, items: [item('a', 'completed')] }
    await monitor.tick()
    await monitor.tick()
    expect(finished).toEqual(['a'])
  })

  it('ignores downloads that were already complete when first seen, and ones that vanish', async () => {
    const { state, finished, monitor } = setup([item('done', 'completed'), item('gone', 'downloading')])
    await monitor.tick()
    state.list = { reachable: true, items: [item('done', 'completed')] }
    await monitor.tick()
    expect(finished).toEqual([])
  })

  it('does not mistake an unreachable qBittorrent for a finished download', async () => {
    const { state, finished, monitor } = setup([item('a', 'downloading')])
    await monitor.tick()
    state.list = { reachable: false, items: [] }
    await monitor.tick()
    state.list = { reachable: true, items: [item('a', 'completed')] }
    await monitor.tick()
    expect(finished).toEqual(['a'])
  })
})

// --- through the API, against a fake qBittorrent ---

interface FakeTorrent {
  hash: string
  name: string
  state: string
  progress: number
  tags: string
  total_size: number
  dlspeed: number
  eta: number
  added_on: number
}
const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)
const HASH_FOREIGN = 'c'.repeat(40)
const torrent = (hash: string, tags: string, over: Partial<FakeTorrent> = {}): FakeTorrent => ({
  hash, name: `torrent-${hash[0]}`, state: 'downloading', progress: 0.3, tags, total_size: 5e9, dlspeed: 1e6, eta: 600, added_on: 1_700_000_000, ...over,
})

interface FakeFile {
  index: number
  name: string
  size: number
  progress: number
  priority: number
}

function fakeQBittorrent(opts: { v4: boolean }) {
  const torrents: FakeTorrent[] = []
  const calls: string[] = []
  const files = new Map<string, FakeFile[]>()
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (url.pathname === '/api/v2/auth/login') return void res.writeHead(200, { 'Set-Cookie': 'SID=ok; path=/' }).end('Ok.')
      if (req.headers.cookie !== 'SID=ok') return void res.writeHead(403).end()
      const form = new URLSearchParams(body)
      switch (url.pathname) {
        case '/api/v2/app/version':
          return void res.writeHead(200).end(opts.v4 ? 'v4.6.7' : 'v5.0.1')
        case '/api/v2/app/webapiVersion':
          return void res.writeHead(200).end('2.9.3')
        case '/api/v2/torrents/info': {
          const tag = url.searchParams.get('tag')
          const hashes = url.searchParams.get('hashes')?.split('|')
          const out = torrents.filter((t) => (!tag || t.tags.split(',').includes(tag)) && (!hashes || hashes.includes(t.hash)))
          return void res.writeHead(200).end(JSON.stringify(out))
        }
        case '/api/v2/torrents/stop':
        case '/api/v2/torrents/start':
        case '/api/v2/torrents/pause':
        case '/api/v2/torrents/resume':
          // qBittorrent 4 only knows pause/resume, 5 only stop/start.
          if (!(opts.v4 ? /\/(pause|resume)$/ : /\/(stop|start)$/).test(url.pathname)) return void res.writeHead(404).end()
          calls.push(`${url.pathname.split('/').pop()} ${form.get('hashes')}`)
          return void res.writeHead(200).end()
        case '/api/v2/torrents/files':
          return void res.writeHead(200).end(JSON.stringify(files.get(url.searchParams.get('hash') ?? '') ?? []))
        case '/api/v2/torrents/filePrio': {
          const list = files.get(form.get('hash') ?? '') ?? []
          calls.push(`filePrio ${form.get('id')} -> ${form.get('priority')}`)
          for (const id of (form.get('id') ?? '').split('|')) {
            const f = list.find((x) => x.index === Number(id))
            if (f) f.priority = Number(form.get('priority'))
          }
          return void res.writeHead(200).end()
        }
        case '/api/v2/torrents/delete':
          calls.push(`delete ${form.get('hashes')} files=${form.get('deleteFiles')}`)
          return void res.writeHead(200).end()
      }
      res.writeHead(404).end()
    })
  })
  const listening = new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)))
  return { server, torrents, calls, files, url: () => listening }
}

let dir: string
let server: RunningServer
let base: string
let movies: string
const qb = fakeQBittorrent({ v4: false })
const old = fakeQBittorrent({ v4: true })

const send = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const connect = async (fake: ReturnType<typeof fakeQBittorrent>) =>
  expect((await send('PUT', '/downloads/client', { qbittorrent: { url: await fake.url(), username: 'a', password: 'b' } })).status).toBe(200)

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'theama-manager-'))
  movies = join(dir, 'Movies')
  mkdirSync(movies)
  server = await startServer(loadConfig({ THEAMA_DATA_DIR: join(dir, 'data'), THEAMA_PORT: '0', THEAMA_FFPROBE: 'none' }))
  base = `http://127.0.0.1:${server.port}/api/v1`
  qb.torrents.push(torrent(HASH_A, 'theama,theama-movie'), torrent(HASH_B, 'theama,theama-series', { state: 'pausedDL' }), torrent(HASH_FOREIGN, 'my-own-tag'))
})
afterAll(async () => {
  await server.stop('test finished')
  qb.server.close()
  old.server.close()
  await rm(dir, { recursive: true, force: true })
})

describe('the download list', () => {
  it('is empty and unreachable until qBittorrent is set up', async () => {
    expect(DownloadList.parse(await (await send('GET', '/downloads')).json())).toEqual({ reachable: false, items: [] })
  })

  it('shows only the downloads Theama added', async () => {
    await connect(qb)
    const list = DownloadList.parse(await (await send('GET', '/downloads')).json())
    expect(list.reachable).toBe(true)
    expect(list.items.map((i) => i.hash).sort()).toEqual([HASH_A, HASH_B])
    expect(list.items.find((i) => i.hash === HASH_A)).toMatchObject({ state: 'downloading', kind: 'movie', progress: 0.3, eta: 600 })
    expect(list.items.find((i) => i.hash === HASH_B)).toMatchObject({ state: 'paused', kind: 'series' })
  })
})

describe('controlling a download', () => {
  it('pauses and resumes with the qBittorrent 5 names', async () => {
    expect((await send('POST', `/downloads/${HASH_A}/pause`)).status).toBe(200)
    expect((await send('POST', `/downloads/${HASH_A}/resume`)).status).toBe(200)
    expect(qb.calls).toEqual([`stop ${HASH_A}`, `start ${HASH_A}`])
  })

  it('falls back to pause and resume on qBittorrent 4', async () => {
    old.torrents.push(torrent(HASH_A, 'theama,theama-movie'))
    await connect(old)
    expect((await send('POST', `/downloads/${HASH_A}/pause`)).status).toBe(200)
    expect((await send('POST', `/downloads/${HASH_A}/resume`)).status).toBe(200)
    expect(old.calls).toEqual([`pause ${HASH_A}`, `resume ${HASH_A}`])
    await connect(qb)
  })

  it('removes a download, keeping the files unless asked', async () => {
    expect((await send('DELETE', `/downloads/${HASH_B}`)).status).toBe(200)
    expect((await send('DELETE', `/downloads/${HASH_B}?deleteFiles=true`)).status).toBe(200)
    expect(qb.calls.slice(-2)).toEqual([`delete ${HASH_B} files=false`, `delete ${HASH_B} files=true`])
  })

  it('never touches a torrent it did not add', async () => {
    const before = qb.calls.length
    for (const [method, path] of [['POST', `/downloads/${HASH_FOREIGN}/pause`], ['POST', `/downloads/${HASH_FOREIGN}/resume`], ['DELETE', `/downloads/${HASH_FOREIGN}?deleteFiles=true`]]) {
      expect((await send(method!, path!)).status, `${method} ${path}`).toBe(404)
    }
    expect(qb.calls).toHaveLength(before)
  })

  it('rejects something that is not a hash', async () => {
    expect((await send('POST', '/downloads/not-a-hash/pause')).status).toBe(400)
    expect((await send('DELETE', `/downloads/${HASH_A}?deleteFiles=maybe`)).status).toBe(400)
  })
})

describe('when a download finishes', () => {
  it('scans the library folder chosen for that kind', async () => {
    const src = await send('POST', '/library/sources', { path: movies, libraryType: 'movies' })
    const { id } = (await src.json()) as { id: number }
    await send('PUT', '/settings', { downloadMovieSourceId: id })
    // Let the scan the new folder triggers by itself finish first, so the next one is the one we are looking for.
    const jobs = async () => ScanJobList.parse(await (await send('GET', '/scans')).json()).items.filter((j) => j.sourceId === id)
    const until = async (probe: () => Promise<boolean>) => {
      for (let i = 0; i < 100 && !(await probe()); i++) await new Promise((r) => setTimeout(r, 50))
    }
    await until(async () => (await jobs()).length > 0 && (await jobs()).every((j) => j.status !== 'queued' && j.status !== 'running'))
    const before = (await jobs()).length

    const t = qb.torrents.find((x) => x.hash === HASH_A)!
    await send('POST', `/downloads/${HASH_A}/resume`) // looks: still downloading
    t.progress = 1
    t.state = 'uploading'
    await send('POST', `/downloads/${HASH_A}/resume`) // looks again: finished
    await until(async () => (await jobs()).length > before)
    expect((await jobs()).length).toBe(before + 1)
  })
})

// --- choosing files, and managing torrents Theama did not add ---

const file = (index: number, name: string, priority = 1): FakeFile => ({ index, name, size: (index + 1) * 1e8, progress: 0, priority })

describe('choosing the files of a download', () => {
  it('lists the files and which are wanted', async () => {
    qb.files.set(HASH_A, [file(0, 'Show/S01E01.mkv'), file(1, 'Show/S01E02.mkv'), file(2, 'Show/sample.mkv', 0)])
    const list = DownloadFileList.parse(await (await send('GET', `/downloads/${HASH_A}/files`)).json())
    expect(list.files.map((f) => [f.index, f.wanted])).toEqual([[0, true], [1, true], [2, false]])
  })

  it('skips what is unticked and enables what is ticked, changing nothing else', async () => {
    qb.calls.length = 0
    const res = await send('PUT', `/downloads/${HASH_A}/files`, { wanted: [0, 2] })
    expect(res.status).toBe(200)
    expect(qb.calls).toEqual(['filePrio 1 -> 0', 'filePrio 2 -> 1'])
    expect(qb.files.get(HASH_A)!.map((f) => f.priority)).toEqual([1, 0, 1])
  })

  it('refuses nothing wanted, an unknown file, and a torrent without a file list yet', async () => {
    expect((await send('PUT', `/downloads/${HASH_A}/files`, { wanted: [] })).status).toBe(400)
    const unknown = await send('PUT', `/downloads/${HASH_A}/files`, { wanted: [9] })
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('invalid_selection')
    qb.torrents.push(torrent(HASH_B, 'theama,theama-series', { state: 'metaDL' }))
    const pending = await send('PUT', `/downloads/${HASH_B}/files`, { wanted: [0] })
    expect(pending.status).toBe(409)
    expect(((await pending.json()) as { error: { code: string } }).error.code).toBe('files_not_ready')
    expect(DownloadFileList.parse(await (await send('GET', `/downloads/${HASH_B}/files`)).json()).files).toEqual([])
  })

  it('does not reach into torrents that are not ours', async () => {
    expect((await send('GET', `/downloads/${HASH_FOREIGN}/files`)).status).toBe(404)
    expect((await send('PUT', `/downloads/${HASH_FOREIGN}/files`, { wanted: [0] })).status).toBe(404)
  })
})

describe('managing every torrent', () => {
  it('lists and controls the other torrents only after the person turns it on', async () => {
    qb.calls.length = 0
    expect((await send('PUT', '/settings', { downloadsShowAll: true })).status).toBe(200)
    const list = DownloadList.parse(await (await send('GET', '/downloads')).json())
    expect(list.items.find((i) => i.hash === HASH_FOREIGN)).toMatchObject({ own: false, kind: null })
    expect(list.items.find((i) => i.hash === HASH_A)).toMatchObject({ own: true, kind: 'movie' })

    expect((await send('POST', `/downloads/${HASH_FOREIGN}/pause`)).status).toBe(200)
    expect((await send('DELETE', `/downloads/${HASH_FOREIGN}?deleteFiles=true`)).status).toBe(200)
    expect(qb.calls).toEqual([`stop ${HASH_FOREIGN}`, `delete ${HASH_FOREIGN} files=true`])
  })

  it('still refuses a hash qBittorrent has never heard of', async () => {
    expect((await send('POST', `/downloads/${'d'.repeat(40)}/pause`)).status).toBe(404)
  })

  it('goes back to its own downloads when turned off', async () => {
    await send('PUT', '/settings', { downloadsShowAll: false })
    const list = DownloadList.parse(await (await send('GET', '/downloads')).json())
    expect(list.items.every((i) => i.own)).toBe(true)
    expect((await send('POST', `/downloads/${HASH_FOREIGN}/pause`)).status).toBe(404)
  })
})
