import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMpcVariables, planTracking, trackPlayback, type PositionSample, type TrackerOptions } from './position-tracking'

const FAST: TrackerOptions = { pollMs: 15, reportEveryMs: 40, connectGraceMs: 300, finalRetryDelaysMs: [1, 3] }
const FILE = 'Show S01E01.mkv'

type Report = { fileId: number; sample: PositionSample; final: boolean }
const collector = () => {
  const reports: Report[] = []
  return { reports, report: async (fileId: number, sample: PositionSample, final: boolean) => void reports.push({ fileId, sample, final }) }
}
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
const until = async (what: string, probe: () => boolean, ms = 4000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()))
})

async function listenHttp(handler: Parameters<typeof createHttpServer>[1]): Promise<{ server: HttpServer; port: number; close: () => Promise<void> }> {
  const server = createHttpServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  closers.push(close)
  const address = server.address()
  return { server, port: typeof address === 'object' && address ? address.port : 0, close }
}

describe('parseMpcVariables', () => {
  it('reads the state, position, length and file name of the web interface page', () => {
    const html = '<p id="file">Show &amp; Tell.mkv</p><p id="state">2</p><p id="position">754000</p><p id="duration">2700000</p>'
    expect(parseMpcVariables(html)).toEqual({ state: 2, positionMs: 754000, durationMs: 2700000, file: 'Show & Tell.mkv', filePath: null })
    expect(parseMpcVariables('nothing here')).toEqual({ state: null, positionMs: null, durationMs: null, file: null, filePath: null })
  })
  it('decodes paths and numeric entities once, preserving literal entity text in filenames', () => {
    expect(parseMpcVariables('<p id="filepath">D:\\Shows\\Tom&#39;s &amp; Jerry &#x3B1;.mkv</p><p id="file">&amp;quot;.mkv</p>'))
      .toMatchObject({ filePath: "D:\\Shows\\Tom's & Jerry α.mkv", file: '&quot;.mkv' })
  })
})

describe('planTracking', () => {
  it('plans a pipe for mpv, a port and password for VLC, a port for MPC, and nothing for others', async () => {
    expect(await planTracking('mpv')).toMatchObject({ kind: 'mpv' })
    const vlc = await planTracking('vlc')
    expect(vlc).toMatchObject({ kind: 'vlc' })
    expect(vlc && vlc.kind === 'vlc' && vlc.port > 0 && vlc.password.length >= 16).toBe(true)
    expect(await planTracking('mpc-be')).toMatchObject({ kind: 'mpc' })
    expect(await planTracking('potplayer')).toBeNull()
    expect(await planTracking('system')).toBeNull()
    expect(await planTracking('custom')).toBeNull()
    const a = await planTracking('vlc')
    const b = await planTracking('vlc')
    expect(a && b && a.kind === 'vlc' && b.kind === 'vlc' && a.password !== b.password).toBe(true)
  })
})

describe('watching VLC', () => {
  it('recognizes a different playlist input even when both files have the same filename', async () => {
    let item = 2
    const { port } = await listenHttp((_req, res) => res.end(JSON.stringify({ state: 'playing', currentplid: item,
      time: item === 2 ? 2600 : 10, length: 2700, information: { category: { meta: { filename: FILE } } } })))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'vlc', port, password: 'p' } }, report, FAST)
    await until('first input', () => reports.length > 0)
    item = 3
    await t.done
    expect(t.reason).toBe('changed')
    expect(reports.every((r) => r.sample.positionSeconds === 2600)).toBe(true)
  })
  it('finalizes at EOF while VLC stays open, ignores reset positions, and still notices another file', async () => {
    let status = { state: 'playing', time: 2699, length: 2700, information: { category: { meta: { filename: FILE } } } }
    const { port } = await listenHttp((_req, res) => res.end(JSON.stringify(status)))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'vlc', port, password: 'p' } }, report, FAST)
    await until('last second', () => reports.length > 0)
    status = { state: 'stopped', time: 0, length: 0, information: { category: { meta: { filename: '' } } } }
    expect((await t.finished).reason).toBe('ended')
    expect(reports.at(-1)).toMatchObject({ final: true, sample: { positionSeconds: 2700, durationSeconds: 2700 } })
    expect(t.reason).toBeUndefined()
    status.information.category.meta.filename = 'Other.mkv'
    await t.done
    expect(t.reason).toBe('changed')
    expect(reports.filter((r) => r.final)).toHaveLength(1)
  })

  it.each(['paused', 'playing'])('does not advance on a %s sample near the end', async (state) => {
    let polls = 0
    const { port } = await listenHttp((_req, res) => {
      polls++
      res.end(JSON.stringify({ state, time: 2699, length: 2700, information: { category: { meta: { filename: FILE } } } }))
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'vlc', port, password: 'p' } }, report, FAST)
    await until('several polls', () => polls >= 3)
    expect(reports.some((r) => r.final)).toBe(false)
    t.stop()
    await t.done
  })

  it('does not confuse an ordinary stop at 90% with EOF', async () => {
    let state = 'playing'
    let polls = 0
    const { port } = await listenHttp((_req, res) => {
      polls++
      res.end(JSON.stringify({ state, time: 2430, length: 2700, information: { category: { meta: { filename: FILE } } } }))
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'vlc', port, password: 'p' } }, report, FAST)
    await until('initial progress', () => reports.length > 0)
    const before = polls
    state = 'stopped'
    await until('stopped status', () => polls > before + 1)
    expect(reports.some((r) => r.final)).toBe(false)
    t.stop()
    await t.done
  })

  it('forwards the position with the password, and sends a final report when VLC goes away', async () => {
    let time = 100
    const seenAuth: (string | undefined)[] = []
    const { port, close } = await listenHttp((req, res) => {
      seenAuth.push(req.headers.authorization)
      time += 60
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ state: 'playing', time, length: 2700, information: { category: { meta: { filename: FILE } } } }))
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 3, fileName: FILE, plan: { kind: 'vlc', port, password: 'secret' } }, report, FAST)
    await until('some reports', () => reports.length >= 2)
    expect(seenAuth[0]).toBe(`Basic ${Buffer.from(':secret').toString('base64')}`)
    expect(reports.every((r) => r.fileId === 3 && r.sample.durationSeconds === 2700)).toBe(true)
    expect(reports.filter((r) => r.final)).toEqual([])
    // VLC closes: three failed polls in a row end the viewing with a final report of the last position.
    await close()
    await t.done
    const last = reports[reports.length - 1]!
    expect(last.final).toBe(true)
    expect(last.sample.positionSeconds).toBeGreaterThanOrEqual(160)
  })

  it('stops following when VLC starts another file, so positions are never filed under the wrong one', async () => {
    let name = FILE
    const { port } = await listenHttp((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ state: 'playing', time: 900, length: 2700, information: { category: { meta: { filename: name } } } }))
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'vlc', port, password: 'p' } }, report, FAST)
    await until('first report', () => reports.length >= 1)
    name = 'Another.mkv'
    await t.done
    expect(reports[reports.length - 1]!.final).toBe(true)
    expect(reports.every((r) => r.sample.positionSeconds === 900)).toBe(true)
  })

  it('does not report a stopped player (its time resets to 0)', async () => {
    const { port } = await listenHttp((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ state: 'stopped', time: 0, length: 0 }))
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'vlc', port, password: 'p' } }, report, FAST)
    await new Promise((r) => setTimeout(r, 150))
    t.stop()
    await t.done
    expect(reports).toEqual([])
  })

  it('gives up quietly when the interface never comes up', async () => {
    const { reports, report } = collector()
    const plan = await planTracking('vlc') // a free port nobody listens on
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: plan! }, report, { ...FAST, connectGraceMs: 120 })
    await t.done
    expect(reports).toEqual([])
  })
})

describe('watching MPC-HC / MPC-BE', () => {
  const variables = (file: string, position = 2600000, duration = 2700000, state = 2, path = '') =>
    `<p id="file">${file}</p><p id="filepath">${path}</p><p id="state">${state}</p><p id="position">${position}</p><p id="duration">${duration}</p>`

  it('ignores playlist restoration before the requested file supplies its first playing sample', async () => {
    let polls = 0
    const { port } = await listenHttp((_req, res) => res.end(++polls === 1 ? variables(FILE, 0, 0, -1)
      : polls === 2 ? variables('Restored.mkv', 0, 0, -1) : variables(FILE)))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port } }, report, FAST)
    await until('requested playback after restored playlist', () => reports.length > 0)
    t.stop()
    await t.done
    expect(reports[0]?.sample.positionSeconds).toBe(2600)
  })

  it('recognizes a running graph held at its exact endpoint when MPC omits the native EOF notification', async () => {
    const { port } = await listenHttp((_req, res) => res.end(variables(FILE, 8000, 8000, 2)))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port } }, report, FAST)
    expect((await t.finished).reason).toBe('ended')
    expect(reports.at(-1)?.sample).toEqual({ positionSeconds: 8, durationSeconds: 8 })
    t.stop()
    await t.done
  })

  it('does not infer EOF from a paused graph, even at the duration boundary', async () => {
    let polls = 0
    const { port } = await listenHttp((_req, res) => { polls++; res.end(variables(FILE, 8000, 8000, 1)) })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port } }, report, FAST)
    await until('paused samples', () => polls >= 3)
    expect(reports.some((r) => r.final)).toBe(false)
    t.stop()
    await t.done
  })

  it('allows the full startup grace after an empty status page followed by transient interface failures', async () => {
    let polls = 0
    const { port } = await listenHttp((_req, res) => {
      polls++
      if (polls > 1 && polls < 6) { res.writeHead(503); res.end(); return }
      res.end(polls === 1 ? variables('', 0, 0) : variables(FILE))
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port } }, report, FAST)
    await until('player ready after transient startup errors', () => reports.length > 0)
    expect(polls).toBeGreaterThanOrEqual(6)
    t.stop()
    await t.done
  })

  it('retains an EOF notification arriving before the first identified position sample', async () => {
    const { port } = await listenHttp((_req, res) => res.end(variables(FILE, 7900, 8000, 1)))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port }, onEnded: (listener) => {
      listener()
      return () => undefined
    } }, report, FAST)
    expect((await t.finished).reason).toBe('ended')
    expect(reports.at(-1)?.sample).toEqual({ positionSeconds: 8, durationSeconds: 8 })
    t.stop()
    await t.done
  })

  it('finalizes once on native EOF without closing the process and unregisters the listener', async () => {
    let onEnded: (() => void) | undefined
    let subscribed = true
    const { port } = await listenHttp((_req, res) => res.end(variables(FILE, 2699900)))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port }, onEnded: (listener) => {
      onEnded = listener
      return () => { subscribed = false }
    } }, report, FAST)
    await until('sample', () => reports.length > 0)
    onEnded!()
    onEnded!()
    expect((await t.finished).reason).toBe('ended')
    expect(t.reason).toBeUndefined()
    expect(reports.at(-1)?.sample.positionSeconds).toBe(2700)
    t.stop()
    await t.done
    expect(reports.filter((r) => r.final)).toHaveLength(1)
    expect(subscribed).toBe(false)
  })

  it('reads positions in milliseconds from variables.html', async () => {
    let ms = 300_000
    const { port } = await listenHttp((req, res) => {
      expect(req.url).toBe('/variables.html')
      ms += 20_000
      res.end(`<p id="file">${FILE}</p><p id="state">2</p><p id="position">${ms}</p><p id="duration">2700000</p>`)
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 9, fileName: FILE, plan: { kind: 'mpc', port } }, report, FAST)
    await until('a report', () => reports.length >= 1)
    t.stop()
    await t.done
    expect(reports[0]!.sample.durationSeconds).toBe(2700)
    expect(reports[0]!.sample.positionSeconds).toBeGreaterThanOrEqual(320)
    expect(reports[reports.length - 1]!.final).toBe(true)
  })

  it('waits through empty startup filenames before following the episode', async () => {
    let polls = 0
    const { port } = await listenHttp((_req, res) => res.end(++polls < 3 ? variables('', 0, 0) : variables(FILE)))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port } }, report, FAST)
    await until('episode position', () => reports.length > 0)
    t.stop()
    await t.done
    expect(polls).toBeGreaterThanOrEqual(3)
    expect(reports.every((r) => r.sample.positionSeconds === 2600)).toBe(true)
  })

  it('gives up on an interface that never identifies a file', async () => {
    const { port } = await listenHttp((_req, res) => res.end(variables('', 0, 0)))
    const { reports, report } = collector()
    await trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port } }, report, { ...FAST, connectGraceMs: 50 }).done
    expect(reports).toEqual([])
  })

  it('prefers full paths and stops when the same filename is loaded from a different folder', async () => {
    let path = `D:\\Shows\\${FILE}`
    const { port } = await listenHttp((_req, res) => res.end(variables('player display title', 2600000, 2700000, 2, path)))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, filePath: `d:/shows/${FILE}`, plan: { kind: 'mpc', port } }, report, FAST)
    await until('a matching full path', () => reports.length > 0)
    path = `D:\\Other\\${FILE}`
    await t.done
    expect(reports.filter((r) => r.final)).toHaveLength(1)
    expect(reports.at(-1)?.sample.positionSeconds).toBe(2600)
  })

  it('falls back to filenames and ends when a different episode starts', async () => {
    let name = FILE
    const { port } = await listenHttp((_req, res) => res.end(variables(name)))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, filePath: `D:\\Shows\\${FILE}`, plan: { kind: 'mpc', port } }, report, FAST)
    await until('first report', () => reports.length > 0)
    name = 'Show S01E02.mkv'
    await t.done
    expect(reports.filter((r) => r.final)).toHaveLength(1)
  })

  it('keeps the last duration and position through stopped-state resets, and finalizes immediately on process exit', async () => {
    let html = variables(FILE)
    let polls = 0
    const { port } = await listenHttp((_req, res) => { polls++; res.end(html) })
    const { reports, report } = collector()
    const { promise: exited, resolve: exit } = deferred()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port }, exited }, report, FAST)
    await until('first report', () => reports.length > 0)
    html = variables(FILE, 2650000, 0)
    await until('position with missing duration', () => reports.some((r) => r.sample.positionSeconds === 2650))
    html = variables('', 0, 0, 0)
    const beforeReset = polls
    await until('shutdown reset', () => polls > beforeReset)
    exit()
    await t.done
    expect(reports.filter((r) => r.final)).toEqual([{ fileId: 1, final: true, sample: { positionSeconds: 2650, durationSeconds: 2700 } }])
  })

  it('interrupts a long poll interval as soon as the player process exits', async () => {
    const { port } = await listenHttp((_req, res) => res.end(variables(FILE)))
    const { reports, report } = collector()
    const { promise: exited, resolve: exit } = deferred()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port }, exited }, report, { ...FAST, pollMs: 60000 })
    await until('first report', () => reports.length > 0)
    exit()
    await t.done
    expect(reports.filter((r) => r.final)).toHaveLength(1)
  })

  it('polls more often near the end so short episodes do not finish between normal polls', async () => {
    let polls = 0
    const { port } = await listenHttp((_req, res) => res.end(variables(FILE, ++polls === 1 ? 6000 : 7600, 8000)))
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port } }, report, { ...FAST, pollMs: 5000 })
    try {
      await until('near-end sample', () => reports.some((r) => r.sample.positionSeconds === 7.6), 1500)
    } finally {
      t.stop()
      await t.done
    }
    expect(reports.at(-1)?.sample).toEqual({ positionSeconds: 7.6, durationSeconds: 8 })
  })
})

describe('watching mpv', () => {
  async function fakeMpv(script: (socket: Socket) => void): Promise<string> {
    const unique = `theama-test-${process.pid}-${Math.random().toString(16).slice(2)}`
    const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\${unique}` : join(tmpdir(), `${unique}.sock`)
    const sockets = new Set<Socket>()
    const server: NetServer = createNetServer((socket) => {
      sockets.add(socket)
      script(socket)
    })
    await new Promise<void>((resolve) => server.listen(pipe, resolve))
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          sockets.forEach((s) => s.destroy())
          server.close(() => resolve())
        }),
    )
    return pipe
  }
  const change = (name: string, data: unknown): string => `${JSON.stringify({ event: 'property-change', id: 1, name, data })}\n`

  it('finalizes on eof-reached while the IPC connection remains open', async () => {
    let player: Socket | undefined
    const pipe = await fakeMpv((socket) => {
      player = socket
      socket.on('error', () => undefined)
      socket.write(change('filename', FILE) + change('duration', 2700) + change('time-pos', 2699.96))
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 5, fileName: FILE, plan: { kind: 'mpv', pipe } }, report, FAST)
    await until('sample', () => reports.length > 0)
    player!.write(change('eof-reached', true) + change('time-pos', null) + change('eof-reached', true))
    expect((await t.finished).reason).toBe('ended')
    expect(t.reason).toBeUndefined()
    expect(reports.at(-1)?.sample.positionSeconds).toBe(2700)
    player!.write(change('filename', 'Other.mkv'))
    await t.done
    expect(t.reason).toBe('changed')
    expect(reports.filter((r) => r.final)).toHaveLength(1)
  })

  it('stops at start-file before a new file can publish positions under the old episode', async () => {
    let player: Socket | undefined
    const pipe = await fakeMpv((socket) => {
      player = socket
      socket.on('error', () => undefined)
      socket.write(change('filename', FILE) + change('duration', 2700) + change('time-pos', 1500))
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 5, fileName: FILE, plan: { kind: 'mpv', pipe } }, report, FAST)
    await until('sample', () => reports.length > 0)
    player!.write(JSON.stringify({ event: 'start-file' }) + '\n' + change('time-pos', 9) + change('filename', FILE))
    await t.done
    expect(t.reason).toBe('changed')
    expect(reports.every((r) => r.sample.positionSeconds === 1500)).toBe(true)
  })

  it('subscribes to the properties, forwards time-pos, and ends with a final report when mpv quits', async () => {
    const asked: string[] = []
    const pipe = await fakeMpv((socket) => {
      socket.setEncoding('utf8')
      socket.on('data', (d: string) => asked.push(...d.split('\n').filter(Boolean)))
      socket.on('error', () => undefined)
      socket.write(change('filename', FILE) + change('duration', 2700))
      let pos = 400
      const timer = setInterval(() => socket.write(change('time-pos', (pos += 25.5))), 20)
      setTimeout(() => {
        clearInterval(timer)
        socket.end()
      }, 250)
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 5, fileName: FILE, plan: { kind: 'mpv', pipe } }, report, FAST)
    await t.done
    expect(asked.map((l) => (JSON.parse(l) as { command: unknown[] }).command[2])).toEqual(['time-pos', 'duration', 'filename', 'eof-reached'])
    expect(reports.length).toBeGreaterThanOrEqual(2)
    expect(reports.every((r) => r.fileId === 5 && r.sample.durationSeconds === 2700)).toBe(true)
    const last = reports[reports.length - 1]!
    expect(last.final).toBe(true)
    expect(last.sample.positionSeconds).toBeGreaterThan(400)
  })

  it('ignores null positions (end of file) and a split JSON line, and stops when mpv loads another file', async () => {
    const pipe = await fakeMpv((socket) => {
      socket.on('error', () => undefined)
      const line = change('time-pos', 1500)
      socket.write(change('filename', FILE) + line.slice(0, 10))
      setTimeout(() => socket.write(line.slice(10) + change('time-pos', null) + change('filename', 'Other.mkv') + change('time-pos', 9)), 60)
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 5, fileName: FILE, plan: { kind: 'mpv', pipe } }, report, FAST)
    await t.done
    expect(reports.map((r) => [r.sample.positionSeconds, r.final])).toEqual([[1500, false], [1500, true]])
  })

  it('gives up quietly when the pipe never appears', async () => {
    const { reports, report } = collector()
    const plan = await planTracking('mpv')
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: plan! }, report, { ...FAST, connectGraceMs: 100 })
    await t.done
    expect(reports).toEqual([])
  })

  it('stop() ends tracking on request', async () => {
    const pipe = await fakeMpv((socket) => {
      socket.on('error', () => undefined)
      socket.write(change('filename', FILE) + change('time-pos', 700))
    })
    const { reports, report } = collector()
    const t = trackPlayback({ fileId: 5, fileName: FILE, plan: { kind: 'mpv', pipe } }, report, FAST)
    await until('a report', () => reports.length >= 1)
    t.stop()
    await t.done
    expect(reports[reports.length - 1]!.final).toBe(true)
  })
})

describe('reporting problems', () => {
  it('serializes reports, drains pending saves, and retries a failed final report before returning next-up', async () => {
    const { port } = await listenHttp((_req, res) => {
      res.end(`<p id="file">${FILE}</p><p id="state">2</p><p id="position">2600000</p><p id="duration">2700000</p>`)
    })
    const { promise: unblock, resolve: release } = deferred()
    const calls: boolean[] = []
    let finalAttempts = 0
    let active = 0
    let maxActive = 0
    const nextUp = { nextUp: { title: 'Show' } }
    const t = trackPlayback({ fileId: 1, fileName: FILE, plan: { kind: 'mpc', port } }, async (_id, _sample, final) => {
      active++
      maxActive = Math.max(maxActive, active)
      calls.push(final)
      try {
        if (!final) await unblock
        if (final && ++finalAttempts < 3) throw new Error('service temporarily unavailable')
        return final ? nextUp : undefined
      } finally { active-- }
    }, { ...FAST, reportEveryMs: 0 })
    await until('first pending save', () => calls.length === 1)
    await new Promise((r) => setTimeout(r, 65))
    t.stop()
    release()
    expect(await t.done).toEqual(nextUp)
    expect(maxActive).toBe(1)
    expect(calls.filter((final) => !final).length).toBeGreaterThan(1)
    expect(calls.slice(-3)).toEqual([true, true, true])
  })

  it('a backend that fails never breaks tracking', async () => {
    const { port } = await listenHttp((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ state: 'playing', time: 800, length: 2700, information: { category: { meta: { filename: FILE } } } }))
    })
    let calls = 0
    let finalAttempts = 0
    const t = trackPlayback(
      { fileId: 1, fileName: FILE, plan: { kind: 'vlc', port, password: 'p' } },
      async (_id, _sample, final) => {
        calls++
        if (final) finalAttempts++
        throw new Error('backend down')
      },
      FAST,
    )
    await until('a call', () => calls >= 1)
    t.stop()
    await expect(t.done).resolves.toBeUndefined()
    expect(finalAttempts).toBe(3)
  })
})
