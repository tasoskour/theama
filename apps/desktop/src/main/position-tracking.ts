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
  /** Native MPC end-of-stream notifications, scoped to this player instance. */
  onEnded?(listener: () => void): () => void
}

export type PlaybackEnd = 'ended' | 'closed' | 'changed' | 'unavailable' | 'stopped'
export interface PlaybackTracker<R> {
  stop(): void
  /** Final progress is saved once, even when the player remains open after EOF. */
  finished: Promise<{ result: R | undefined; reason: PlaybackEnd }>
  /** The source remains connected after EOF to detect an external file change. */
  done: Promise<R | undefined>
  readonly reason: PlaybackEnd | undefined
}

/** Forwards a sample to the backend. `final` marks the last one of this viewing. Resolves to whatever the backend answered. */
export type ReportProgress<R = void> = (fileId: number, sample: PositionSample, final: boolean) => Promise<R>

const normal = (s: string): string => s.normalize('NFC').trim().toLowerCase()
const sameName = (a: string, b: string): boolean => normal(a) === normal(b)
const samePath = (a: string, b: string): boolean => sameName(a.replace(/\\/g, '/'), b.replace(/\\/g, '/'))

interface Source {
  run(onSample: (sample: PositionSample) => void, onEnded: () => void, signal: AbortSignal): Promise<PlaybackEnd>
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => delay(ms, undefined, { signal }).catch(() => undefined)

/** Polls an HTTP status page until the player goes away. */
function pollingSource(options: TrackerOptions, read: (signal: AbortSignal) => Promise<{ sample: PositionSample | null; name: string | null; path?: string | null; ended?: boolean; changed?: boolean }>, job: Pick<TrackJob, 'fileName' | 'filePath'>): Source {
  return {
    async run(onSample, onEnded, signal) {
      const startedAt = Date.now()
      let identified = false
      let failures = 0
      while (!signal.aborted) {
        let pollMs = identified ? options.pollMs : Math.min(options.pollMs, 300)
        try {
          const { sample, name, path, ended, changed } = await read(signal)
          if (signal.aborted) return 'stopped'
          if (identified && changed) return 'changed'
          failures = 0
          let matches: boolean | null = null
          if (path?.trim() && job.filePath) {
            matches = samePath(path, job.filePath)
          } else if (name?.trim()) {
            matches = sameName(name, job.fileName)
          }
          if (matches === false && identified) return 'changed'
          // A restored playlist can briefly publish the requested filename before the new file opens.
          // Establish identity only once that file actually supplies playback progress.
          if (matches === true && sample) identified = true
          if (!identified) {
            if (Date.now() - startedAt > options.connectGraceMs) return 'unavailable'
            await sleep(pollMs, signal)
            continue // MPC can publish an empty file while it is opening the video.
          }
          if (sample && matches === true) {
            onSample(sample)
            if (sample.durationSeconds !== null && sample.durationSeconds > 0) {
              // Short files can finish between five-second polls. Sample more often near the end,
              // rather than inferring completion from a process exit that could also be a manual close.
              pollMs = Math.min(options.pollMs, Math.max(100, (sample.durationSeconds - sample.positionSeconds) * 250))
            }
          }
          if (ended) onEnded()
        } catch {
          failures++
          if (!identified && Date.now() - startedAt > options.connectGraceMs) return 'unavailable'
          if (identified && failures >= 3) return 'unavailable'
        }
        await sleep(pollMs, signal)
      }
      return 'stopped'
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
  let previousState: string | undefined
  let previous: PositionSample | null = null
  let inputId: number | undefined
  return pollingSource(
    options,
    async (signal) => {
      const s = (await getJson(`http://127.0.0.1:${plan.port}/requests/status.json`, auth, signal)) as {
        state?: string
        time?: number
        length?: number
        currentplid?: number
        information?: { category?: { meta?: { filename?: string } } }
      }
      const name = s.information?.category?.meta?.filename ?? null
      const playing = (s.state === 'playing' || s.state === 'paused') && typeof s.time === 'number'
      const hasInput = typeof s.currentplid === 'number' && s.currentplid >= 0 && playing
      const changed = hasInput && inputId !== undefined && s.currentplid !== inputId
      if (hasInput && inputId === undefined && name && sameName(name, fileName)) inputId = s.currentplid
      const ended = s.state === 'stopped' && previousState === 'playing' && previous?.durationSeconds !== null &&
        previous !== null && previous.durationSeconds > 0 && previous.positionSeconds >= previous.durationSeconds - 2
      const sample = playing ? { positionSeconds: s.time!, durationSeconds: s.length && s.length > 0 ? s.length : null } : null
      previousState = s.state
      if (sample) previous = { ...sample, durationSeconds: sample.durationSeconds ?? previous?.durationSeconds ?? null }
      return { name, sample, ended, changed }
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
        // MPC-HC's runtime Do Nothing action can leave the graph running at its exact endpoint
        // without sending a native play-mode/EOF notification. A paused graph never qualifies.
        ended: v.state === 2 && v.durationMs !== null && v.durationMs > 0 && v.positionMs !== null && v.positionMs >= v.durationMs,
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
    async run(onSample, onEnded, signal) {
      const socket = await openPipe(signal)
      if (!socket) return 'unavailable'
      return new Promise<PlaybackEnd>((resolve) => {
        let position: number | null = null
        let duration: number | null = null
        let buffer = ''
        let identified = false
        const emit = (): void => {
          if (identified && position !== null) onSample({ positionSeconds: position, durationSeconds: duration })
        }
        const finish = (reason: PlaybackEnd): void => {
          socket.destroy()
          resolve(reason)
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
            if (msg.event === 'shutdown') return finish('closed')
            if (msg.event === 'start-file' && identified) return finish('changed')
            if (msg.event !== 'property-change') continue
            if (msg.name === 'time-pos' && typeof msg.data === 'number') {
              position = msg.data
              emit()
            } else if (msg.name === 'duration' && typeof msg.data === 'number') {
              duration = msg.data
              emit()
            } else if (msg.name === 'filename' && typeof msg.data === 'string' && msg.data.trim()) {
              if (!sameName(msg.data, fileName)) {
                if (identified) return finish('changed')
              } else {
                identified = true
                emit()
              }
            } else if (msg.name === 'eof-reached' && msg.data === true && identified) {
              onEnded()
            }
          }
        })
        socket.once('close', () => resolve(signal.aborted ? 'stopped' : 'unavailable'))
        socket.once('error', () => finish('unavailable'))
        const watch = (id: number, name: string): string => `${JSON.stringify({ command: ['observe_property', id, name] })}\n`
        socket.write(watch(1, 'time-pos') + watch(2, 'duration') + watch(3, 'filename') + watch(4, 'eof-reached'))
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
 * more (marked final) at EOF or when tracking ends. EOF saves progress while the source stays connected;
 * `finished` supplies the confirmed next-up and `done` observes eventual shutdown or file changes. Never rejects.
 */
export function trackPlayback<R = void>(job: TrackJob, report: ReportProgress<R>, options: TrackerOptions = DEFAULT_TRACKER_OPTIONS): PlaybackTracker<R> {
  const controller = new AbortController()
  let reason: PlaybackEnd | undefined
  const closed = (): void => { reason = 'closed'; controller.abort() }
  void job.exited?.then(closed, closed)
  let last: PositionSample | null = null
  let lastReportAt = 0
  let pending: Promise<unknown> = Promise.resolve()
  let finalReport: Promise<R | undefined> | undefined
  let awaitingEnd = false
  let resolveFinished!: (value: { result: R | undefined; reason: PlaybackEnd }) => void
  const finished = new Promise<{ result: R | undefined; reason: PlaybackEnd }>((resolve) => { resolveFinished = resolve })
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

  const finalize = (end: PlaybackEnd): Promise<R | undefined> => {
    if (!finalReport) {
      const snapshot = last
      // A true EOF can precede the last position notification by a frame (or VLC's integer second).
      const sample = end === 'ended' && snapshot?.durationSeconds
        ? { ...snapshot, positionSeconds: snapshot.durationSeconds } : snapshot
      finalReport = pending.then(() => sample ? safeReport(sample, true) : undefined)
      void finalReport.then((result) => resolveFinished({ result, reason: end }))
    }
    return finalReport
  }
  const onEnded = (): void => {
    awaitingEnd = true
    if (last && !controller.signal.aborted) void finalize('ended')
  }
  const unsubscribe = job.onEnded?.(onEnded)

  const done = (async () => {
    try {
      const sourceReason = await sourceFor(job, options).run(
        (sample) => {
          if (finalReport || controller.signal.aborted || !Number.isFinite(sample.positionSeconds) || sample.positionSeconds < 0) return
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
          if (awaitingEnd) void finalize('ended')
        },
        onEnded,
        controller.signal,
      )
      reason ??= sourceReason
    } catch {
      reason ??= 'unavailable'
    }
    unsubscribe?.()
    controller.abort()
    return finalize(reason ?? 'stopped')
  })()
  return { stop: () => { reason ??= 'stopped'; controller.abort() }, done, finished, get reason() { return reason } }
}
