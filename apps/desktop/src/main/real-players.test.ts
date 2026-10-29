import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { NextUpOffer, ProgressResult } from '@theama/contracts'
import { PlayerManager, launchDetached, type LaunchedPlayer } from './players'
import { createMpcBridge } from './mpc-bridge'
import { trackPlayback, type PlaybackTracker, type TrackingPlan } from './position-tracking'

// Opt-in Windows smoke test. Point THEAMA_PLAYER_SMOKE_ROOT at portable distributions in
// vlc/, mpv/, mpc-hc/ and mpc-be/. It never changes an installed player's preferences.
const root = process.env.THEAMA_PLAYER_SMOKE_ROOT
function executable(dir: string, name: string): string {
  const direct = join(dir, name)
  if (existsSync(direct)) return direct
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(dir, entry.name, name))) return join(dir, entry.name, name)
  }
  throw new Error(`Portable player not found: ${name}`)
}

/** A tiny uncompressed AVI, generated locally so smoke tests need no codec downloads or media assets. */
function video(): Buffer {
  const width = 160, height = 90, frames = 30, frameBytes = width * height * 3
  const chunk = (name: string, data: Buffer) => {
    const header = Buffer.alloc(8); header.write(name); header.writeUInt32LE(data.length, 4)
    return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])])
  }
  const avih = Buffer.alloc(56)
  ;[100000, frameBytes * 10, 0, 0x10, frames, 0, 1, frameBytes, width, height].forEach((v, i) => avih.writeUInt32LE(v, i * 4))
  const strh = Buffer.alloc(56); strh.write('vidsDIB ')
  strh.writeUInt32LE(1, 20); strh.writeUInt32LE(10, 24); strh.writeUInt32LE(frames, 32)
  strh.writeUInt32LE(frameBytes, 36); strh.writeUInt32LE(0xffffffff, 40)
  strh.writeInt16LE(width, 52); strh.writeInt16LE(height, 54)
  const strf = Buffer.alloc(40)
  strf.writeUInt32LE(40); strf.writeInt32LE(width, 4); strf.writeInt32LE(height, 8)
  strf.writeUInt16LE(1, 12); strf.writeUInt16LE(24, 14); strf.writeUInt32LE(frameBytes, 20)
  const hdrl = chunk('LIST', Buffer.concat([Buffer.from('hdrl'), chunk('avih', avih),
    chunk('LIST', Buffer.concat([Buffer.from('strl'), chunk('strh', strh), chunk('strf', strf)]))]))
  const images = Array.from({ length: frames }, (_, i) => chunk('00db', Buffer.alloc(frameBytes, 32 + i * 3)))
  const index = Buffer.alloc(frames * 16)
  for (let i = 0; i < frames; i++) {
    index.write('00db', i * 16); index.writeUInt32LE(0x10, i * 16 + 4)
    index.writeUInt32LE(4 + i * (frameBytes + 8), i * 16 + 8); index.writeUInt32LE(frameBytes, i * 16 + 12)
  }
  return chunk('RIFF', Buffer.concat([Buffer.from('AVI '), hdrl, chunk('LIST', Buffer.concat([Buffer.from('movi'), ...images])), chunk('idx1', index)]))
}

describe.skipIf(process.platform !== 'win32' || !root)('real portable players', () => {
  it.each(['vlc', 'mpv', 'mpc-hc', 'mpc-be'] as const)('%s reaches EOF and advances twice in the same process', async (kind) => {
    const exeName = { vlc: 'vlc.exe', mpv: 'mpv.exe', 'mpc-hc': 'mpc-hc64.exe', 'mpc-be': 'mpc-be64.exe' }[kind]
    let exe = executable(join(root!, kind), exeName)
    const media = mkdtempSync(join(tmpdir(), 'theama-real-player-'))
    const files = [1, 2, 3].map((id) => join(media, `Σειρά S01E0${id}.avi`))
    const clip = video()
    for (const file of files) {
      writeFileSync(file, clip)
      writeFileSync(file.replace('.avi', '.el.srt'), '1\n00:00:00,000 --> 00:00:02,900\nΔοκιμή\n')
    }
    if (kind.startsWith('mpc')) {
      // MPC stores playlists beside its executable. Give every run its own portable profile.
      const playerDir = join(media, 'player')
      cpSync(dirname(exe), playerDir, { recursive: true })
      exe = join(playerDir, exeName)
      rmSync(join(playerDir, 'default.mpcpl'), { force: true })
      rmSync(exe.replace('.exe', '.history.ini'), { force: true })
      writeFileSync(exe.replace('.exe', '.ini'), '[Settings]\r\nUpdaterAutoCheck=0\r\n')
    }
    const processes: LaunchedPlayer[] = []
    const trackers: PlaybackTracker<ProgressResult | undefined>[] = []
    const plans: TrackingPlan[] = []
    const offers: NextUpOffer[] = []
    const samples: { fileId: number; position: number; final: boolean }[] = []
    const manager = new PlayerManager({
      host: { env: { ProgramFiles: root }, exists: () => true }, getPrefs: () => ({ defaultId: kind, custom: [] }), setPrefs: () => undefined,
      fetchLaunchInfo: async (id) => ({ ok: true, info: { fileId: id, path: files[id - 1]!, fileName: basename(files[id - 1]!), kind: 'episode', title: 'Smoke',
        subtitle: { path: files[id - 1]!.replace('.avi', '.el.srt'), language: 'el' }, subtitleLanguages: ['el', 'en'], resumeSeconds: id === 2 ? 1 : null } }),
      openWithSystem: async () => '', reportLaunched: async () => undefined, createMpcBridge,
      launch: async (_exe, args) => {
        const extras = kind === 'vlc' ? [`--config=${join(media, 'vlc.rc')}`, '--no-save-config', '--no-qt-privacy-ask', '--no-media-library'] : kind === 'mpv' ? ['--no-config'] : []
        const player = await launchDetached(exe, [...extras, ...args])
        processes.push(player)
        return player
      },
      track: (job) => {
        plans.push(job.plan)
        const tracker = trackPlayback<ProgressResult | undefined>(job, async (fileId, sample, final) => {
          samples.push({ fileId, position: sample.positionSeconds, final })
          return final && fileId < 3 ? { outcome: 'watched', nextUp: { title: 'Smoke', countdownSeconds: 0,
            next: { fileId: fileId + 1, season: 1, episode: fileId + 1, label: `S01E0${fileId + 1}`, resumeSeconds: null } } } : { outcome: 'watched' }
        }, { pollMs: 100, reportEveryMs: 100, connectGraceMs: 45000, finalRetryDelaysMs: [] })
        trackers.push(tracker)
        return tracker
      },
      onNextUp: (offer) => { offers.push(offer) },
    })
    const until = async (probe: () => boolean) => {
      const deadline = Date.now() + 60000
      while (!probe()) {
        if (Date.now() > deadline) throw new Error(`Player timed out: ${JSON.stringify(samples.slice(-5))}; ends: ${trackers.map((t) => t.reason)}`)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    try {
      expect(await manager.play(1, kind)).toMatchObject({ ok: true })
      await until(() => offers.length === 1)
      expect(trackers[0]!.reason).toBeUndefined()
      expect(await manager.playNext(offers[0]!.offerId)).toMatchObject({ ok: true })
      await until(() => offers.length === 2)
      expect(await manager.playNext(offers[1]!.offerId)).toMatchObject({ ok: true })
      await until(() => samples.filter((sample) => sample.final).length === 3)
      expect(processes).toHaveLength(1)
      expect(trackers.at(-1)!.reason).toBeUndefined()
    } catch (error) {
      const plan = plans.at(-1)
      let status = ''
      if (plan && plan.kind !== 'mpv') {
        status = await fetch(`http://127.0.0.1:${plan.port}/${plan.kind === 'vlc' ? 'requests/status.json' : 'variables.html'}`, {
          signal: AbortSignal.timeout(1000), headers: plan.kind === 'vlc' ? { Authorization: `Basic ${Buffer.from(`:${plan.password}`).toString('base64')}` } : {},
        }).then((res) => res.text()).catch((e: Error) => e.message)
      }
      throw new Error(`${String(error)}; player status: ${status.slice(0, 3000)}`)
    } finally {
      manager.dispose()
      for (const player of processes) { if (player.pid) { try { process.kill(player.pid) } catch { /* Already closed. */ } } }
      await Promise.all(processes.map((player) => player.exited))
      await Promise.all(trackers.map((tracker) => tracker.done))
      rmSync(media, { recursive: true, force: true })
    }
  }, 150_000)
})
