import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createServer as httpServer } from 'node:http'
import { createServer as netServer, type Socket } from 'node:net'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { LaunchInfo, NextUpOffer, PlayerKind, ProgressResult } from '@theama/contracts'
import { PlayerManager } from './players'
import { trackPlayback, type PositionSample, type TrackJob } from './position-tracking'

const until = async (probe: () => boolean): Promise<void> => {
  const deadline = Date.now() + 4000
  while (!probe()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for playback')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

/** Real tracker + real HTTP/pipe controls against players that remain alive at EOF. */
async function fixture(kind: 'vlc' | 'mpv' | 'mpc-hc' | 'mpc-be') {
  const dir = mkdtempSync(join(tmpdir(), 'theama-session-'))
  const files = [1, 2, 3].map((id) => join(dir, `Show S01E0${id}.mkv`))
  const subtitles = files.map((file) => file.replace('.mkv', '.el.srt'))
  for (const file of [...files, ...subtitles]) writeFileSync(file, 'fixture')
  const offers: NextUpOffer[] = []
  const cancelled: string[] = []
  const reports: { fileId: number; sample: PositionSample; final: boolean }[] = []
  const launches: string[][] = []
  const controls: unknown[][] = []
  const headers: (string | undefined)[] = []
  const trackers: ReturnType<typeof trackPlayback<ProgressResult | undefined>>[] = []
  const ended = new Set<() => void>()
  const watchers = new Set<Socket>()
  let path = files[0]!
  let position = 0
  let state = 'playing'
  let stopProcess: (() => void) | undefined
  let closeServer: (() => Promise<void>) | undefined
  let available = true
  let matches = true
  let failLoad = false
  let autoPlay = true
  let defaultId: string = kind
  let currentReportStart = 0
  let finalHold: Promise<void> | undefined
  const change = (name: string, data: unknown) => `${JSON.stringify({ event: 'property-change', name, data })}\n`
  const broadcast = () => {
    for (const socket of watchers) socket.write(change('filename', basename(path)) + change('duration', 2700) + change('time-pos', position))
  }
  const load = (file: string, start: number) => { path = file; position = start; state = 'playing'; broadcast() }

  const manager = new PlayerManager({
    host: { env: { ProgramFiles: 'C:\\PF' }, exists: () => true },
    getPrefs: () => ({ defaultId, custom: [] }), setPrefs: (prefs) => { defaultId = prefs.defaultId },
    openWithSystem: async () => '',
    fetchLaunchInfo: async (id) => available ? { ok: true, info: {
      fileId: id, path: files[id - 1]!, fileName: basename(files[id - 1]!), title: 'Show', kind: 'episode',
      subtitle: { path: subtitles[id - 1]!, language: 'el' }, subtitleLanguages: ['el', 'en'], resumeSeconds: id === 2 ? 754 : null,
    } satisfies LaunchInfo } : { ok: false, code: 'unavailable', message: 'File is offline' },
    reportLaunched: async () => undefined,
    createMpcBridge: async () => ({ slaveWindow: '1234', onEnded: (listener) => { ended.add(listener); return () => { ended.delete(listener) } },
      load: async (args) => {
        if (failLoad) throw new Error('MPC rejected the file')
        controls.push(args)
        load(args[0]!, Number(args[args.indexOf('/start') + 1]) / 1000)
      }, close: () => { ended.clear() },
    }),
    launch: async (_exe, args) => {
      launches.push(args)
      const exited = new Promise<void>((resolve) => { stopProcess = resolve })
      if (kind === 'mpv') {
        const pipe = args.find((arg) => arg.startsWith('--input-ipc-server='))!.split('=').slice(1).join('=')
        load(args.at(-1)!, 0)
        const sockets = new Set<Socket>()
        const server = netServer((socket) => {
          sockets.add(socket)
          socket.on('error', () => undefined)
          socket.once('close', () => { sockets.delete(socket); watchers.delete(socket) })
          socket.setEncoding('utf8')
          let buffer = ''
          socket.on('data', (chunk: string) => {
            buffer += chunk
            let nl: number
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const msg = JSON.parse(buffer.slice(0, nl)) as { command: unknown[]; request_id?: number }
              buffer = buffer.slice(nl + 1)
              const [command, property] = msg.command
              if (command === 'observe_property') {
                watchers.add(socket)
                broadcast()
              } else {
                controls.push(msg.command)
                let data: unknown = null
                if (command === 'get_property') data = property === 'path' ? path : 'mpv 0.41.0'
                if (command === 'loadfile' && !failLoad) {
                  const options = msg.command.at(-1) as { start: string }
                  load(String(property), Number(options.start))
                }
                socket.write(`${JSON.stringify({ request_id: msg.request_id, error: failLoad ? 'error' : 'success', data })}\n`)
              }
            }
          })
        })
        await new Promise<void>((resolve) => server.listen(pipe, resolve))
        closeServer = async () => { sockets.forEach((socket) => socket.destroy()); await new Promise<void>((resolve) => server.close(() => resolve())) }
      } else {
        const port = kind === 'vlc' ? Number(args.find((a) => a.startsWith('--http-port='))!.split('=')[1]) : Number(args[args.indexOf('/webport') + 1])
        load(kind === 'vlc' ? args.at(-1)! : args[0]!, 0)
        const server = httpServer((req, res) => {
          const url = new URL(req.url!, 'http://127.0.0.1')
          if (kind === 'vlc') {
            headers.push(req.headers.authorization)
            if (url.searchParams.get('command') === 'in_play') {
              if (failLoad) { res.writeHead(500); res.end(); return }
              controls.push(url.searchParams.getAll('option'))
              load(fileURLToPath(url.searchParams.get('input')!), Number(url.searchParams.getAll('option').find((o) => o.startsWith(':start-time='))!.split('=')[1]))
            }
            res.end(JSON.stringify({ state, time: state === 'stopped' ? 0 : position, length: state === 'stopped' ? 0 : 2700,
              information: { category: { meta: { filename: state === 'stopped' ? '' : basename(path) } } } }))
          } else res.end(`<p id="file">${basename(path)}</p><p id="filepath">${path}</p><p id="state">${state === 'playing' ? 2 : 0}</p><p id="position">${position * 1000}</p><p id="duration">2700000</p>`)
        })
        await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
        closeServer = async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
      }
      return { exited }
    },
    track: (job: TrackJob) => {
      currentReportStart = reports.length
      const tracker = trackPlayback<ProgressResult | undefined>(job, async (fileId, sample, final) => {
        reports.push({ fileId, sample, final })
        if (final) await finalHold
        return final && fileId < 3 && autoPlay ? { outcome: 'watched', nextUp: {
          title: 'Show', countdownSeconds: 5, next: { fileId: fileId + 1, season: 1, episode: fileId + 1, label: `S01E0${fileId + 1}`, resumeSeconds: null },
        } } : { outcome: 'saved' }
      }, { pollMs: 10, reportEveryMs: 0, connectGraceMs: 300, finalRetryDelaysMs: [1] })
      trackers.push(tracker)
      return tracker
    },
    // A test can simulate an external file change in the small gap before a continuation request.
    playerMatches: async () => matches,
    autoPlayEnabled: async () => autoPlay,
    onNextUp: (offer) => { offers.push(offer) }, onNextUpCancelled: (id) => { cancelled.push(id) },
  })
  const closePlayer = async () => { stopProcess?.(); await closeServer?.(); closeServer = undefined }
  cleanups.push(async () => {
    manager.dispose()
    await closePlayer()
    await Promise.all(trackers.map((tracker) => tracker.done))
    rmSync(dir, { recursive: true, force: true })
  })
  const finish = async (fileId = 1) => {
    await until(() => reports.slice(currentReportStart).some((r) => r.fileId === fileId))
    position = 2699
    broadcast()
    await until(() => reports.slice(currentReportStart).some((r) => r.fileId === fileId && r.sample.positionSeconds >= 2699))
    if (kind === 'vlc') state = 'stopped'
    else if (kind === 'mpv') watchers.forEach((socket) => socket.write(change('eof-reached', true)))
    else ended.forEach((listener) => listener())
    await trackers.at(-1)!.finished
    await Promise.resolve()
  }
  return { manager, offers, cancelled, reports, launches, controls, headers, files, subtitles, finish, closePlayer,
    setAvailable: (value: boolean) => { available = value }, setMatches: (value: boolean) => { matches = value },
    setFailLoad: () => { failLoad = true }, setAutoPlay: (value: boolean) => { autoPlay = value },
    setDefault: (value: PlayerKind) => { defaultId = value },
    externalFile: () => { load(join(dir, 'Other.mkv'), 500) },
    holdFinal: () => { let release!: () => void; finalHold = new Promise<void>((resolve) => { release = resolve }); return release },
    nearEnd: async () => { position = 2500; broadcast(); await until(() => reports.some((r) => r.sample.positionSeconds === 2500)) },
  }
}

describe.each(['vlc', 'mpv', 'mpc-hc', 'mpc-be'] as const)('%s series sessions', (kind) => {
  it('advances twice in one player, honors resume/subtitles, and stops after the final episode', async () => {
    const f = await fixture(kind)
    expect(await f.manager.play(1, kind)).toMatchObject({ ok: true })
    await f.finish()
    expect(f.offers).toHaveLength(1)
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: true })
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: false })
    await f.finish(2)
    expect(f.offers).toHaveLength(2)
    expect(await f.manager.playNext(f.offers[1]!.offerId)).toMatchObject({ ok: true })
    await f.finish(3)
    expect(f.offers).toHaveLength(2)
    expect(f.launches).toHaveLength(1)
    expect(f.reports.filter((r) => r.final).map((r) => r.fileId)).toEqual([1, 2, 3])
    expect(f.reports.some((r) => r.fileId === 2 && r.sample.positionSeconds === 754)).toBe(true)
    if (kind === 'vlc') {
      expect(f.controls[0]).toContain(`:sub-file=${f.subtitles[1]}`)
      expect(f.controls[0]).toContain(':start-time=754')
      expect(f.headers.every((header) => header?.startsWith('Basic '))).toBe(true)
    } else if (kind === 'mpv') expect(f.controls).toContainEqual(['sub-add', f.subtitles[1], 'select'])
    else expect(f.controls[0]).toContain(f.subtitles[1])
  })

  it('continues after manual close near the end using the original player despite a changed default', async () => {
    const f = await fixture(kind)
    await f.manager.play(1, kind)
    await f.nearEnd()
    await f.closePlayer()
    await until(() => f.offers.length === 1)
    f.setDefault('system')
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: true })
    expect(f.launches).toHaveLength(2)
    expect(f.launches[1]).toContain(f.files[1])
  })

  it('closes during an existing countdown without emitting another offer', async () => {
    const f = await fixture(kind)
    await f.manager.play(1, kind)
    await f.finish()
    await f.closePlayer()
    expect(f.offers).toHaveLength(1)
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: true })
    expect(f.launches).toHaveLength(2)
  })

  it('cancels permanently for this episode, including a later process exit', async () => {
    const f = await fixture(kind)
    await f.manager.play(1, kind)
    await f.finish()
    f.manager.cancelNext(f.offers[0]!.offerId)
    await f.closePlayer()
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: false })
    expect(f.offers).toHaveLength(1)
    expect(f.launches).toHaveLength(1)
  })

  it('rejects missing files and failed live-player controls without starting another process', async () => {
    const f = await fixture(kind)
    await f.manager.play(1, kind)
    await f.finish()
    f.setAvailable(false)
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: false, code: 'unavailable' })
    expect(f.launches).toHaveLength(1)
    // A fresh viewing gets a fresh, independent offer.
    f.setAvailable(true)
    await f.closePlayer()
    await f.manager.play(1, kind)
    await f.finish()
    f.setFailLoad()
    expect(await f.manager.playNext(f.offers.at(-1)!.offerId)).toMatchObject({ ok: false, code: 'launch_failed' })
    expect(f.launches).toHaveLength(2)
  })

  it('invalidates a pending offer when the player loads another file', async () => {
    const f = await fixture(kind)
    await f.manager.play(1, kind)
    await f.finish()
    f.externalFile()
    await until(() => f.cancelled.length > 0)
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: false })
    expect(f.launches).toHaveLength(1)
  })

  it('does not offer a next episode when autoplay is disabled', async () => {
    const f = await fixture(kind)
    f.setAutoPlay(false)
    await f.manager.play(1, kind)
    await f.finish()
    expect(f.offers).toHaveLength(0)
    expect(f.reports.filter((r) => r.final)).toHaveLength(1)
  })

  it('honors autoplay being disabled after the countdown was offered', async () => {
    const f = await fixture(kind)
    await f.manager.play(1, kind)
    await f.finish()
    f.setAutoPlay(false)
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: false })
    expect(f.launches).toHaveLength(1)
    expect(f.controls).toHaveLength(0)
  })

  it('rechecks identity when a file changes just before accepting the offer', async () => {
    const f = await fixture(kind)
    await f.manager.play(1, kind)
    await f.finish()
    f.setMatches(false)
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: false, code: 'unavailable' })
    expect(f.launches).toHaveLength(1)
    expect(f.controls).toHaveLength(0)
  })

  it('invalidates the pending offer when playback is manually started', async () => {
    const f = await fixture(kind)
    await f.manager.play(1, kind)
    await f.finish()
    // Explicit system playback supersedes the old series without opening another tracked peer.
    expect(await f.manager.play(2, 'system')).toMatchObject({ ok: true })
    expect(await f.manager.playNext(f.offers[0]!.offerId)).toMatchObject({ ok: false })
    expect(f.cancelled).toContain(f.offers[0]!.offerId)
  })

  it('ignores a final response arriving after the player switched files', async () => {
    const f = await fixture(kind)
    await f.manager.play(1, kind)
    const release = f.holdFinal()
    const finishing = f.finish()
    await until(() => f.reports.some((report) => report.final))
    f.externalFile()
    // Wait for the source to see the identity change before releasing the backend response.
    await new Promise((resolve) => setTimeout(resolve, 50))
    release()
    await finishing
    expect(f.offers).toHaveLength(0)
  })
})
