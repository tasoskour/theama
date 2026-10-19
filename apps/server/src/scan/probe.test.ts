import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ProbeError, createFfprobeRunner, findFfprobe, parseFfprobeJson, runPool } from './probe'

const sample = {
  format: { format_name: 'matroska,webm', duration: '2754.321000' },
  streams: [
    { codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080 },
    { codec_type: 'audio', codec_name: 'eac3', channels: 6, tags: { language: 'eng', title: 'Surround' } },
    { codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { LANGUAGE: 'gre' } },
    { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'ell', title: 'Full' }, disposition: { default: 1 } },
    { codec_type: 'subtitle', codec_name: 'ass', tags: { language: 'und' }, disposition: { forced: 1 } },
  ],
}

describe('parseFfprobeJson', () => {
  it('extracts duration, size, codecs, container and subtitle count', () => {
    expect(parseFfprobeJson(sample)).toEqual({
      durationMs: 2754321,
      width: 1920,
      height: 1080,
      container: 'matroska',
      videoCodec: 'hevc',
      audioCodecs: ['eac3', 'aac'],
      subtitleCount: 2,
      audioTracks: [
        { codec: 'eac3', language: 'en', channels: 6, title: 'Surround' },
        { codec: 'aac', language: 'el', channels: 2, title: null },
      ],
      subtitleTracks: [
        { codec: 'subrip', language: 'el', title: 'Full', forced: false, default: true },
        { codec: 'ass', language: null, title: null, forced: true, default: false },
      ],
    })
  })
  it('ignores embedded cover art when choosing the video stream', () => {
    const r = parseFfprobeJson({
      format: { format_name: 'mov,mp4', duration: 10 },
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, disposition: { attached_pic: 1 } },
        { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
      ],
    })
    expect(r).toMatchObject({ videoCodec: 'h264', width: 1280, durationMs: 10000, container: 'mov' })
  })
  it('tolerates missing fields (audio-only or unknown duration)', () => {
    expect(parseFfprobeJson({ format: {}, streams: [{ codec_type: 'audio', codec_name: 'mp3' }] })).toEqual({
      durationMs: null, width: null, height: null, container: null, videoCodec: null, audioCodecs: ['mp3'], subtitleCount: 0,
      audioTracks: [{ codec: 'mp3', language: null, channels: null, title: null }],
      subtitleTracks: [],
    })
    expect(parseFfprobeJson({}).audioCodecs).toEqual([])
  })
  it('rejects output of the wrong shape', () => {
    expect(() => parseFfprobeJson('nope')).toThrow(ProbeError)
    expect(() => parseFfprobeJson({ streams: 5 })).toThrow(ProbeError)
  })
})

describe('createFfprobeRunner (real child process, fake ffprobe script)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theama-probe-'))
  const script = join(dir, 'fake-ffprobe.cjs')
  // Behaves like ffprobe: the last argument is the file; names decide the outcome.
  writeFileSync(
    script,
    `const path = process.argv[process.argv.length - 1];
const args = process.argv.slice(2);
if (!args.includes('--') || args.indexOf('--') !== args.length - 2) { console.error('bad args'); process.exit(3) }
if (path.includes('hang')) { setTimeout(() => {}, 60000) }
else if (path.includes('broken')) { console.error('Invalid data found when processing input'); process.exit(1) }
else if (path.includes('garbage')) { console.log('not json') }
else { console.log(JSON.stringify(${JSON.stringify(sample)})) }`,
  )
  afterAll(() => rm(dir, { recursive: true, force: true }))
  const run = (path: string, timeoutMs = 5000) => createFfprobeRunner({ command: process.execPath, prefixArgs: [script], timeoutMs })(path)

  it('passes the file after "--" as a separate argument (no shell, spaces and Greek are safe)', async () => {
    const r = await run('C:\\Μedia\\My Film (2020) [x265].mkv')
    expect(r.videoCodec).toBe('hevc')
  })
  it('reports ffprobe errors with its message', async () => {
    await expect(run('broken.mkv')).rejects.toThrow(/Invalid data found/)
  })
  it('reports invalid JSON', async () => {
    await expect(run('garbage.mkv')).rejects.toThrow(/invalid JSON/)
  })
  it('times out a hung probe', async () => {
    await expect(run('hang.mkv', 300)).rejects.toThrow(/timed out/)
  })
})

describe('findFfprobe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theama-find-'))
  const exe = join(dir, 'ffprobe.exe')
  writeFileSync(exe, '')
  afterAll(() => rm(dir, { recursive: true, force: true }))
  it('honours THEAMA_FFPROBE when the file exists', () => {
    expect(findFfprobe({ THEAMA_FFPROBE: exe }, '')).toBe(exe)
  })
  it('returns null when nothing is installed', () => {
    expect(findFfprobe({ THEAMA_FFPROBE: join(dir, 'missing.exe') }, join(dir, 'nowhere', 'a', 'b', 'main.ts'))).toBeNull()
  })
})

describe('runPool', () => {
  it('limits concurrency and processes everything', async () => {
    let active = 0
    let peak = 0
    const done: number[] = []
    await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      done.push(n)
      active--
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
  it('stops starting new work when asked to', async () => {
    let started = 0
    await runPool([1, 2, 3, 4, 5, 6], 1, async () => { started++ }, () => started >= 2)
    expect(started).toBe(2)
  })
})
