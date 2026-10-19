import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

/** Technical facts about a video file, as reported by FFprobe. */
export interface ProbeResult {
  durationMs: number | null
  width: number | null
  height: number | null
  container: string | null
  videoCodec: string | null
  audioCodecs: string[]
  subtitleCount: number
}

export class ProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProbeError'
  }
}

/** Probes one file. Rejects with a ProbeError when the file cannot be read as media. */
export type ProbeFn = (path: string) => Promise<ProbeResult>

const FfprobeOutput = z.object({
  format: z
    .object({
      format_name: z.string().optional(),
      duration: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  streams: z
    .array(
      z.object({
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        disposition: z.object({ attached_pic: z.number().optional() }).optional(),
      }),
    )
    .default([]),
})

/** Turns `ffprobe -print_format json -show_format -show_streams` output into a ProbeResult. */
export function parseFfprobeJson(json: unknown): ProbeResult {
  const parsed = FfprobeOutput.safeParse(json)
  if (!parsed.success) throw new ProbeError('FFprobe returned output Theama does not understand')
  const { format, streams } = parsed.data
  // Cover art in an MKV/MP4 shows up as a "video" stream with attached_pic; it is not the movie.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const seconds = format?.duration === undefined ? NaN : Number(format.duration)
  return {
    durationMs: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    container: format?.format_name?.split(',')[0] ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodecs: streams.filter((s) => s.codec_type === 'audio' && s.codec_name).map((s) => s.codec_name!),
    subtitleCount: streams.filter((s) => s.codec_type === 'subtitle').length,
  }
}

export interface FfprobeRunnerOptions {
  /** Executable to run (ffprobe.exe). */
  command: string
  /** Arguments placed before ffprobe's own (lets tests run a script through node). */
  prefixArgs?: string[]
  timeoutMs?: number
}

/** The real probe: ffprobe as a child process, arguments passed as an array, never through a shell. */
export function createFfprobeRunner(options: FfprobeRunnerOptions): ProbeFn {
  const timeout = options.timeoutMs ?? 30_000
  return (path) =>
    new Promise<ProbeResult>((resolve, reject) => {
      execFile(
        options.command,
        [...(options.prefixArgs ?? []), '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '--', path],
        { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout, stderr) => {
          if (err) {
            const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed
            const detail = stderr.trim().split(/\r?\n/)[0]
            return reject(
              new ProbeError(killed ? `FFprobe timed out after ${Math.round(timeout / 1000)} s` : (detail || err.message).slice(0, 300)),
            )
          }
          try {
            resolve(parseFfprobeJson(JSON.parse(stdout)))
          } catch (e) {
            reject(e instanceof ProbeError ? e : new ProbeError('FFprobe returned invalid JSON'))
          }
        },
      )
    })
}

/**
 * Finds ffprobe.exe: THEAMA_FFPROBE, then next to the repository's tools folder (development),
 * then next to the installed server bundle (packaged). Returns null when none exists, in
 * which case scanning still works and technical info is simply unavailable.
 */
export function findFfprobe(env: NodeJS.ProcessEnv = process.env, entryScript: string = process.argv[1] ?? ''): string | null {
  // THEAMA_FFPROBE=none turns probing off explicitly (used by tests).
  if (env.THEAMA_FFPROBE === 'none') return null
  const candidates: string[] = []
  if (env.THEAMA_FFPROBE) candidates.push(env.THEAMA_FFPROBE)
  if (entryScript) {
    const dir = dirname(entryScript) // apps/server/src | apps/server/dist | <resources>/server
    candidates.push(join(dir, '..', '..', '..', 'tools', 'ffprobe', 'bin', 'ffprobe.exe'))
    candidates.push(join(dir, '..', 'ffprobe', 'ffprobe.exe'))
  }
  return candidates.find((c) => existsSync(c)) ?? null
}

/** Runs `worker` over `items` with at most `concurrency` in flight; stops starting new work when `shouldStop()`. */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (!shouldStop()) {
      const i = next++
      if (i >= items.length) return
      await worker(items[i]!)
    }
  })
  await Promise.all(lanes)
}
