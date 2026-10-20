import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseMpcVariables, planTracking, trackPlayback, type PositionSample, type TrackerOptions } from './position-tracking'

const FAST: TrackerOptions = { pollMs: 15, reportEveryMs: 40, connectGraceMs: 300 }
const FILE = 'Show S01E01.mkv'

type Report = { fileId: number; sample: PositionSample; final: boolean }
const collector = () => {
  const reports: Report[] = []
  return { reports, report: async (fileId: number, sample: PositionSample, final: boolean) => void reports.push({ fileId, sample, final }) }
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
    expect(parseMpcVariables(html)).toEqual({ state: 2, positionMs: 754000, durationMs: 2700000, file: 'Show & Tell.mkv' })
    expect(parseMpcVariables('nothing here')).toEqual({ state: null, positionMs: null, durationMs: null, file: null })
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
    expect(asked.map((l) => (JSON.parse(l) as { command: unknown[] }).command[2])).toEqual(['time-pos', 'duration', 'filename'])
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
  it('a backend that fails never breaks tracking', async () => {
    const { port } = await listenHttp((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ state: 'playing', time: 800, length: 2700, information: { category: { meta: { filename: FILE } } } }))
    })
    let calls = 0
    const t = trackPlayback(
      { fileId: 1, fileName: FILE, plan: { kind: 'vlc', port, password: 'p' } },
      async () => {
        calls++
        throw new Error('backend down')
      },
      FAST,
    )
    await until('a call', () => calls >= 1)
    t.stop()
    await expect(t.done).resolves.toBeUndefined()
  })
})
