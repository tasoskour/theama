import { randomBytes } from 'node:crypto'
import { connect, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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
  /** Delays between final-report attempts; periodic reports are not retried. */
  finalRetryDelaysMs?: readonly number[]
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = { pollMs: 5000, reportEveryMs: 15_000, connectGraceMs: 45_000 }

export interface TrackJob {
  fileId: number
  /** The file's name: if the player moves on to another file, tracking this one ends. */
  fileName: string
  /** Full identity where the player exposes it (MPC), to distinguish equal filenames in different folders. */
  filePath?: string
  plan: TrackingPlan
  /** Available for launched processes, so shutdown need not wait for three failed polls. */
  exited?: Promise<void>
}

/** Forwards a sample to the backend. `final` marks the last one of this viewing. Resolves to whatever the backend answered. */
export type ReportProgress<R = void> = (fileId: number, sample: PositionSample, final: boolean) => Promise<R>

const normal = (s: string): string => s.normalize('NFC').trim().toLowerCase()
const sameName = (a: string, b: string): boolean => normal(a) === normal(b)
const samePath = (a: string, b: string): boolean => sameName(a.replace(/\\/g, '/'), b.replace(/\\/g, '/'))

interface Source {
  /** Resolves when the player has closed, or tracking should end for another reason. */
  run(onSample: (sample: PositionSample) => void, signal: AbortSignal): Promise<void>
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => delay(ms, undefined, { signal }).catch(() => undefined)

/** Polls an HTTP status page until the player goes away. */
function pollingSource(options: TrackerOptions, read: (signal: AbortSignal) => Promise<{ sample: PositionSample | null; name: string | null; path?: string | null }>, job: Pick<TrackJob, 'fileName' | 'filePath'>): Source {
  return {
    async run(onSample, signal) {
      const startedAt = Date.now()
      let connected = false
      let identified = false
      let failures = 0
      while (!signal.aborted) {
        let pollMs = identified ? options.pollMs : Math.min(options.pollMs, 300)
        try {
          const { sample, name, path } = await read(signal)
          if (signal.aborted) return
          connected = true
          failures = 0
          if (path?.trim() && job.filePath) {
            if (!samePath(path, job.filePath)) return
            identified = true
          } else if (name?.trim()) {
            if (!sameName(name, job.fileName)) return // the player moved on to another file
            identified = true
          }
          if (!identified) {
            if (Date.now() - startedAt > options.connectGraceMs) return
            await sleep(pollMs, signal)
            continue // MPC can publish an empty file while it is opening the video.
          }
          if (sample) {
            onSample(sample)
            if (sample.durationSeconds !== null && sample.durationSeconds > 0) {
              // Short files can finish between five-second polls. Sample more often near the end,
              // rather than inferring completion from a process exit that could also be a manual close.
              pollMs = Math.min(options.pollMs, Math.max(100, (sample.durationSeconds - sample.positionSeconds) * 250))
            }
          }
        } catch {
          failures++
          if (!connected && Date.now() - startedAt > options.connectGraceMs) return
          if (connected && failures >= 3) return
        }
        await sleep(pollMs, signal)
      }
    },
  }
}

async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function vlcSource(plan: Extract<TrackingPlan, { kind: 'vlc' }>, options: TrackerOptions, fileName: string): Source {
  const auth = { Authorization: `Basic ${Buffer.from(`:${plan.password}`).toString('base64')}` }
  return pollingSource(
    options,
    async (signal) => {
      const s = (await getJson(`http://127.0.0.1:${plan.port}/requests/status.json`, auth, signal)) as {
        state?: string
        time?: number
        length?: number
        information?: { category?: { meta?: { filename?: string } } }
      }
      const name = s.information?.category?.meta?.filename ?? null
      const playing = (s.state === 'playing' || s.state === 'paused') && typeof s.time === 'number'
      return { name, sample: playing ? { positionSeconds: s.time!, durationSeconds: s.length && s.length > 0 ? s.length : null } : null }
    },
    { fileName },
  )
}

/** MPC-HC and MPC-BE publish their state as `<p id="name">value</p>` on /variables.html (times in milliseconds). */
export function parseMpcVariables(html: string): { state: number | null; positionMs: number | null; durationMs: number | null; file: string | null; filePath: string | null } {
  const value = (id: string): string | null => {
    const m = new RegExp(`<p id="${id}">([^<]*)</p>`, 'i').exec(html)
    return m ? m[1]!.replace(/&(amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity, code: string) => {
      const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }
      const key = code.toLowerCase()
      if (named[key]) return named[key]!
      const point = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1))
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
    }).trim() : null
  }
  const num = (id: string): number | null => {
    const v = value(id)
    return v !== null && /^-?\d+$/.test(v) ? Number(v) : null
  }
  return { state: num('state'), positionMs: num('position'), durationMs: num('duration'), file: value('file'), filePath: value('filepath') }
}

function mpcSource(plan: Extract<TrackingPlan, { kind: 'mpc' }>, options: TrackerOptions, job: TrackJob): Source {
  return pollingSource(
    options,
    async (signal) => {
      const res = await fetch(`http://127.0.0.1:${plan.port}/variables.html`, { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const v = parseMpcVariables(await res.text())
      const playing = (v.state === 1 || v.state === 2) && v.positionMs !== null
      return {
        name: v.file,
        path: v.filePath,
        sample: playing ? { positionSeconds: v.positionMs! / 1000, durationSeconds: v.durationMs && v.durationMs > 0 ? v.durationMs / 1000 : null } : null,
      }
    },
    job,
  )
}

/** mpv pushes property changes over its IPC pipe, one JSON object per line; the pipe closing means mpv has quit. */
function mpvSource(plan: Extract<TrackingPlan, { kind: 'mpv' }>, options: TrackerOptions, fileName: string): Source {
  const openPipe = async (signal: AbortSignal): Promise<Socket | null> => {
    const deadline = Date.now() + options.connectGraceMs
    while (!signal.aborted && Date.now() < deadline) {
      const socket = await new Promise<Socket | null>((resolve) => {
        const s = connect({ path: plan.pipe, signal })
        s.once('connect', () => resolve(s))
        s.once('error', () => {
          s.destroy()
          resolve(null)
        })
      })
      if (socket) return socket
      await sleep(Math.min(300, options.pollMs), signal)
    }
    return null
  }

  return {
    async run(onSample, signal) {
      const socket = await openPipe(signal)
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
              emit()
            } else if (msg.name === 'filename' && typeof msg.data === 'string' && msg.data.trim() && !sameName(msg.data, fileName)) {
              return finish() // another file is playing now
            }
          }
        })
        socket.once('close', () => resolve())
        socket.once('error', () => finish())
        const watch = (id: number, name: string): string => `${JSON.stringify({ command: ['observe_property', id, name] })}\n`
        socket.write(watch(1, 'time-pos') + watch(2, 'duration') + watch(3, 'filename'))
      })
    },
  }
}

function sourceFor(job: TrackJob, options: TrackerOptions): Source {
  switch (job.plan.kind) {
    case 'vlc':
      return vlcSource(job.plan, options, job.fileName)
    case 'mpc':
      return mpcSource(job.plan, options, job)
    case 'mpv':
      return mpvSource(job.plan, options, job.fileName)
  }
}

/**
 * Watches one started player and forwards its position to the backend: now and then while it plays, and once
 * more (marked final) when it closes. Returns a function that stops watching, and `done`, which resolves to the
 * backend's answer to the final report (undefined if there was none). Never rejects.
 */
export function trackPlayback<R = void>(job: TrackJob, report: ReportProgress<R>, options: TrackerOptions = DEFAULT_TRACKER_OPTIONS): { stop(): void; done: Promise<R | undefined> } {
  const controller = new AbortController()
  void job.exited?.then(() => controller.abort(), () => controller.abort())
  let last: PositionSample | null = null
  let lastReportAt = 0
  let pending: Promise<unknown> = Promise.resolve()
  const safeReport = async (sample: PositionSample, final: boolean): Promise<R | undefined> => {
    const retries = final ? (options.finalRetryDelaysMs ?? [1000, 3000]) : []
    for (let attempt = 0; attempt <= retries.length; attempt++) {
      try {
        return await report(job.fileId, sample, final)
      } catch {
        if (attempt < retries.length) await sleep(retries[attempt]!)
      }
    }
    return undefined
  }

  const done = (async () => {
    try {
      await sourceFor(job, options).run(
        (sample) => {
          if (controller.signal.aborted || !Number.isFinite(sample.positionSeconds) || sample.positionSeconds < 0) return
          last = {
            positionSeconds: sample.positionSeconds,
            durationSeconds: sample.durationSeconds !== null && Number.isFinite(sample.durationSeconds) && sample.durationSeconds > 0
              ? sample.durationSeconds : (last?.durationSeconds ?? null),
          }
          if (Date.now() - lastReportAt >= options.reportEveryMs) {
            lastReportAt = Date.now()
            const snapshot = last
            pending = pending.then(() => safeReport(snapshot, false))
          }
        },
        controller.signal,
      )
    } catch {
      // A source that fails simply ends tracking.
    }
    controller.abort()
    await pending
    return last ? safeReport(last, true) : undefined
  })()
  return { stop: () => controller.abort(), done }
}
