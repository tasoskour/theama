import { randomBytes } from 'node:crypto'
import { connect, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlayerKind } from '@theama/contracts'

/**
 * Finding out how far an external player has got. Theama starts the player with a switch that makes it listen
 * on this PC only (mpv: a named pipe; VLC and MPC-HC/BE: a web interface on a random port), then watches it.
 * Whatever goes wrong, the outcome is "nothing is tracked": the player is never affected and nothing throws.
 */

/** How a started player will be watched; chosen before launch because it goes on the command line. */
export type TrackingPlan =
  | { kind: 'mpv'; pipe: string }
  | { kind: 'vlc'; port: number; password: string }
  | { kind: 'mpc'; port: number }

export interface PositionSample {
  positionSeconds: number
  durationSeconds: number | null
}

export const TRACKED_KINDS: ReadonlySet<PlayerKind> = new Set<PlayerKind>(['vlc', 'mpv', 'mpc-hc', 'mpc-be'])

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}

/** Picks the pipe, port and password for one launch. Null for players that cannot be watched. */
export async function planTracking(kind: PlayerKind): Promise<TrackingPlan | null> {
  try {
    if (kind === 'mpv') {
      const name = `theama-mpv-${randomBytes(8).toString('hex')}`
      return { kind: 'mpv', pipe: process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`) }
    }
    if (kind === 'vlc') return { kind: 'vlc', port: await freePort(), password: randomBytes(12).toString('hex') }
    if (kind === 'mpc-hc' || kind === 'mpc-be') return { kind: 'mpc', port: await freePort() }
  } catch {
    // No free port: play without tracking.
  }
  return null
}

export interface TrackerOptions {
  /** How often VLC and MPC are asked. */
  pollMs: number
  /** How often a position is forwarded to the backend while playing. */
  reportEveryMs: number
  /** How long to wait for the player's interface to come up before giving up quietly. */
  connectGraceMs: number
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = { pollMs: 5000, reportEveryMs: 15_000, connectGraceMs: 45_000 }

export interface TrackJob {
  fileId: number
  /** The file's name: if the player moves on to another file, tracking this one ends. */
  fileName: string
  plan: TrackingPlan
}

/** Forwards a sample to the backend. `final` marks the last one of this viewing. */
export type ReportProgress = (fileId: number, sample: PositionSample, final: boolean) => Promise<void>

const normal = (s: string): string => s.normalize('NFC').trim().toLowerCase()
const sameName = (a: string, b: string): boolean => normal(a) === normal(b)

interface Source {
  /** Resolves when the player has closed, or tracking should end for another reason. */
  run(onSample: (sample: PositionSample) => void, stopped: () => boolean): Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls an HTTP status page until the player goes away. */
function pollingSource(options: TrackerOptions, read: () => Promise<{ sample: PositionSample | null; name: string | null }>, fileName: string): Source {
  return {
    async run(onSample, stopped) {
      const startedAt = Date.now()
      let connected = false
      let failures = 0
      while (!stopped()) {
        try {
          const { sample, name } = await read()
          connected = true
          failures = 0
          if (name !== null && !sameName(name, fileName)) return // the player moved on to another file
          if (sample) onSample(sample)
        } catch {
          failures++
          if (!connected && Date.now() - startedAt > options.connectGraceMs) return
          if (connected && failures >= 3) return
        }
        await sleep(options.pollMs)
      }
    },
  }
}

async function getJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function vlcSource(plan: Extract<TrackingPlan, { kind: 'vlc' }>, options: TrackerOptions, fileName: string): Source {
  const auth = { Authorization: `Basic ${Buffer.from(`:${plan.password}`).toString('base64')}` }
  return pollingSource(
    options,
    async () => {
      const s = (await getJson(`http://127.0.0.1:${plan.port}/requests/status.json`, auth, 3000)) as {
        state?: string
        time?: number
        length?: number
        information?: { category?: { meta?: { filename?: string } } }
      }
      const name = s.information?.category?.meta?.filename ?? null
      const playing = (s.state === 'playing' || s.state === 'paused') && typeof s.time === 'number'
      return { name, sample: playing ? { positionSeconds: s.time!, durationSeconds: s.length && s.length > 0 ? s.length : null } : null }
    },
    fileName,
  )
}

/** MPC-HC and MPC-BE publish their state as `<p id="name">value</p>` on /variables.html (times in milliseconds). */
export function parseMpcVariables(html: string): { state: number | null; positionMs: number | null; durationMs: number | null; file: string | null } {
  const value = (id: string): string | null => {
    const m = new RegExp(`<p id="${id}">([^<]*)</p>`, 'i').exec(html)
    return m ? m[1]!.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : null
  }
  const num = (id: string): number | null => {
    const v = value(id)
    return v !== null && /^-?\d+$/.test(v) ? Number(v) : null
  }
  return { state: num('state'), positionMs: num('position'), durationMs: num('duration'), file: value('file') }
}

function mpcSource(plan: Extract<TrackingPlan, { kind: 'mpc' }>, options: TrackerOptions, fileName: string): Source {
  return pollingSource(
    options,
    async () => {
      const res = await fetch(`http://127.0.0.1:${plan.port}/variables.html`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const v = parseMpcVariables(await res.text())
      const playing = (v.state === 1 || v.state === 2) && v.positionMs !== null
      return {
        name: v.file,
        sample: playing ? { positionSeconds: v.positionMs! / 1000, durationSeconds: v.durationMs && v.durationMs > 0 ? v.durationMs / 1000 : null } : null,
      }
    },
    fileName,
  )
}

/** mpv pushes property changes over its IPC pipe, one JSON object per line; the pipe closing means mpv has quit. */
function mpvSource(plan: Extract<TrackingPlan, { kind: 'mpv' }>, options: TrackerOptions, fileName: string): Source {
  const openPipe = async (stopped: () => boolean): Promise<Socket | null> => {
    const deadline = Date.now() + options.connectGraceMs
    while (!stopped() && Date.now() < deadline) {
      const socket = await new Promise<Socket | null>((resolve) => {
        const s = connect(plan.pipe)
        s.once('connect', () => resolve(s))
        s.once('error', () => {
          s.destroy()
          resolve(null)
        })
      })
      if (socket) return socket
      await sleep(Math.min(300, options.pollMs))
    }
    return null
  }

  return {
    async run(onSample, stopped) {
      const socket = await openPipe(stopped)
      if (!socket) return
      await new Promise<void>((resolve) => {
        let position: number | null = null
        let duration: number | null = null
        let buffer = ''
        const emit = (): void => {
          if (position !== null) onSample({ positionSeconds: position, durationSeconds: duration })
        }
        const finish = (): void => {
          socket.destroy()
          resolve()
        }
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => {
          buffer += chunk
          let nl: number
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl)
            buffer = buffer.slice(nl + 1)
            let msg: { event?: string; name?: string; data?: unknown }
            try {
              msg = JSON.parse(line) as typeof msg
            } catch {
              continue
            }
            if (msg.event === 'shutdown') return finish()
            if (msg.event !== 'property-change') continue
            if (msg.name === 'time-pos' && typeof msg.data === 'number') {
              position = msg.data
              emit()
            } else if (msg.name === 'duration' && typeof msg.data === 'number') {
              duration = msg.data
            } else if (msg.name === 'filename' && typeof msg.data === 'string' && !sameName(msg.data, fileName)) {
              return finish() // another file is playing now
            }
          }
        })
        socket.once('close', () => resolve())
        socket.once('error', () => finish())
        const watch = (id: number, name: string): string => `${JSON.stringify({ command: ['observe_property', id, name] })}\n`
        socket.write(watch(1, 'time-pos') + watch(2, 'duration') + watch(3, 'filename'))
        const timer = setInterval(() => stopped() && finish(), 200)
        socket.once('close', () => clearInterval(timer))
      })
    },
  }
}

function sourceFor(job: TrackJob, options: TrackerOptions): Source {
  switch (job.plan.kind) {
    case 'vlc':
      return vlcSource(job.plan, options, job.fileName)
    case 'mpc':
      return mpcSource(job.plan, options, job.fileName)
    case 'mpv':
      return mpvSource(job.plan, options, job.fileName)
  }
}

/**
 * Watches one started player and forwards its position to the backend: now and then while it plays, and once
 * more (marked final) when it closes. Returns a function that stops watching. Never rejects.
 */
export function trackPlayback(job: TrackJob, report: ReportProgress, options: TrackerOptions = DEFAULT_TRACKER_OPTIONS): { stop(): void; done: Promise<void> } {
  let stopRequested = false
  let last: PositionSample | null = null
  let lastReportAt = 0
  const safeReport = (sample: PositionSample, final: boolean): Promise<void> => report(job.fileId, sample, final).catch(() => undefined)

  const done = (async () => {
    try {
      await sourceFor(job, options).run(
        (sample) => {
          last = sample
          if (Date.now() - lastReportAt >= options.reportEveryMs) {
            lastReportAt = Date.now()
            void safeReport(sample, false)
          }
        },
        () => stopRequested,
      )
    } catch {
      // A source that fails simply ends tracking.
    }
    if (last) await safeReport(last, true)
  })()
  return { stop: () => void (stopRequested = true), done }
}
