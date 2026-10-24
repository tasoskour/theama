import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { LaunchInfo } from '@theama/contracts'
import { buildArgs, customPlayerId, detectInstalled, launchDetached, PlayerManager, validateCustomExe, type PlayerDeps, type PlayerPrefs } from './players'
import type { TrackJob } from './position-tracking'

const PF = 'C:\\Program Files'
const installed = (...paths: string[]) => ({
  env: { ProgramFiles: PF, 'ProgramFiles(x86)': 'C:\\Program Files (x86)', PATH: '' } as NodeJS.ProcessEnv,
  exists: (p: string) => paths.includes(p),
})

const dir = mkdtempSync(join(tmpdir(), 'theama-players-'))
const video = join(dir, 'Film & Friends; (2020).mkv')
const subtitle = join(dir, 'Film & Friends; (2020).el.srt')
writeFileSync(video, 'x')
writeFileSync(subtitle, 'x')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('detectInstalled', () => {
  it('finds players in Program Files, and on PATH', () => {
    const host = installed(`${PF}\\VideoLAN\\VLC\\vlc.exe`, 'D:\\tools\\mpv.exe')
    host.env.PATH = 'C:\\Windows;D:\\tools'
    expect(detectInstalled(host).map((d) => [d.kind, d.exe])).toEqual([
      ['vlc', `${PF}\\VideoLAN\\VLC\\vlc.exe`],
      ['mpv', 'D:\\tools\\mpv.exe'],
    ])
  })
  it('finds nothing when nothing is installed', () => {
    expect(detectInstalled(installed())).toEqual([])
  })
})

describe('buildArgs', () => {
  const o = { path: 'D:\\Media\\A B & C; "x" (2020).mkv', subtitle: 'D:\\Media\\A B & C; "x" (2020).el.srt', languages: ['el', 'en'] }
  it('passes every value as one separate argument, untouched by any shell', () => {
    expect(buildArgs('vlc', o)).toEqual([`--sub-file=${o.subtitle}`, o.path])
    expect(buildArgs('mpc-hc', o)).toEqual([o.path, '/sub', o.subtitle])
    expect(buildArgs('mpc-be', o)).toEqual([o.path, '/sub', o.subtitle])
  })
  it('puts "--" before the file for mpv, so a file name can never be taken as an option, and asks for the preferred languages', () => {
    expect(buildArgs('mpv', o)).toEqual([`--sub-file=${o.subtitle}`, '--slang=el,en', '--', o.path])
    expect(buildArgs('mpv', { ...o, subtitle: null, languages: [] })).toEqual(['--', o.path])
  })
  it('starts PotPlayer and unknown programs on the file alone', () => {
    expect(buildArgs('potplayer', o)).toEqual([o.path])
    expect(buildArgs('custom', o)).toEqual([o.path])
  })
  it('adds no subtitle switch when there is no subtitle', () => {
    expect(buildArgs('vlc', { ...o, subtitle: null })).toEqual([o.path])
    expect(buildArgs('mpc-hc', { ...o, subtitle: null })).toEqual([o.path])
  })
})

describe('buildArgs with resuming and tracking', () => {
  const base = { path: 'D:\\Media\\Film.mkv', subtitle: null, languages: [] as string[] }
  it('starts at the remembered second', () => {
    expect(buildArgs('vlc', { ...base, resumeSeconds: 754 })).toEqual(['--start-time=754', base.path])
    expect(buildArgs('mpv', { ...base, resumeSeconds: 754 })).toEqual(['--start=754', '--', base.path])
    expect(buildArgs('mpc-hc', { ...base, resumeSeconds: 754 })).toEqual([base.path, '/start', '754000'])
    expect(buildArgs('mpc-be', { ...base, resumeSeconds: 754 })).toEqual([base.path, '/start', '754000'])
    // No remembered position (or one at 0): nothing is added.
    expect(buildArgs('vlc', { ...base, resumeSeconds: null })).toEqual([base.path])
    expect(buildArgs('mpv', { ...base, resumeSeconds: 0 })).toEqual(['--', base.path])
  })
  it('opens a local-only interface for the player that will be watched', () => {
    expect(buildArgs('vlc', { ...base, tracking: { kind: 'vlc', port: 5555, password: 'pw' } })).toEqual([
      '--no-one-instance', '--extraintf=http', '--http-host=127.0.0.1', '--http-port=5555', '--http-password=pw', base.path,
    ])
    expect(buildArgs('mpv', { ...base, tracking: { kind: 'mpv', pipe: 'theama-pipe' } })).toEqual(['--input-ipc-server=theama-pipe', '--', base.path])
    expect(buildArgs('mpc-hc', { ...base, tracking: { kind: 'mpc', port: 6666 } })).toEqual([base.path, '/new', '/webport', '6666'])
  })
  it.each(['mpc-hc', 'mpc-be'] as const)('closes %s episodes in their own instance, retaining resume and subtitles', (kind) => {
    expect(buildArgs(kind, { ...base, subtitle: 'D:\\Media\\Film.el.srt', resumeSeconds: 754, closeAfterPlayback: true, tracking: { kind: 'mpc', port: 6666 } })).toEqual([
      base.path, '/sub', 'D:\\Media\\Film.el.srt', '/start', '754000', '/new', '/play', '/close', '/webport', '6666',
    ])
    expect(buildArgs(kind, { ...base, closeAfterPlayback: true })).toEqual([base.path, '/new', '/play', '/close'])
    expect(buildArgs(kind, { ...base, tracking: { kind: 'mpc', port: 6666 } })).not.toContain('/close')
  })
  it('leaves other players unchanged for episodes', () => {
    for (const kind of ['vlc', 'mpv', 'potplayer', 'custom', 'system'] as const) {
      expect(buildArgs(kind, { ...base, closeAfterPlayback: true })).toEqual(buildArgs(kind, base))
    }
  })
  it('never adds tracking switches for a plan that belongs to another player', () => {
    expect(buildArgs('potplayer', { ...base, resumeSeconds: 60, tracking: { kind: 'mpc', port: 1 } })).toEqual([base.path])
  })
})

describe('validateCustomExe', () => {
  it('accepts an existing program and refuses everything else', () => {
    expect(validateCustomExe(process.execPath)).toBe(process.execPath)
    expect(() => validateCustomExe('player.exe')).toThrow(/full path/)
    expect(() => validateCustomExe('C:\\a\\..\\b.exe')).toThrow(/full path/)
    expect(() => validateCustomExe(join(dir, 'nothing.exe'))).toThrow(/does not exist/)
    expect(() => validateCustomExe(video)).toThrow(/\.exe/)
    expect(() => validateCustomExe(dir + '.exe')).toThrow()
  })
})

describe('launchDetached', () => {
  it('resolves when spawned and separately notifies when the process exits', async () => {
    const launched = await launchDetached(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 100)'])
    await expect(launched.exited).resolves.toBeUndefined()
  })
  it('rejects when the player cannot be spawned', async () => {
    await expect(launchDetached(join(dir, 'missing-player.exe'), [])).rejects.toThrow()
  })
})

describe('PlayerManager', () => {
  let prefs: PlayerPrefs
  let launched: { exe: string; args: string[] }[]
  let opened: string[]
  let reported: number[]
  let info: Awaited<ReturnType<PlayerDeps['fetchLaunchInfo']>>

  const launchInfo = (over: Partial<LaunchInfo> = {}): LaunchInfo => ({
    fileId: 7, path: video, fileName: 'x.mkv', title: 'Film', kind: 'movie',
    subtitle: { path: subtitle, language: 'el' }, subtitleLanguages: ['el', 'en'], resumeSeconds: null, ...over,
  })

  function manager(host = installed(`${PF}\\VideoLAN\\VLC\\vlc.exe`, `${PF}\\mpv\\mpv.exe`, process.execPath)): PlayerManager {
    return new PlayerManager({
      host,
      getPrefs: () => prefs,
      setPrefs: (p) => void (prefs = p),
      launch: async (exe, args) => void launched.push({ exe, args }),
      openWithSystem: async (path) => {
        opened.push(path)
        return ''
      },
      fetchLaunchInfo: async () => info,
      reportLaunched: async (id) => void reported.push(id),
    })
  }

  beforeEach(() => {
    prefs = { defaultId: '', custom: [] }
    launched = []
    opened = []
    reported = []
    info = { ok: true, info: launchInfo() }
  })

  it('lists what is installed plus the system default, and picks VLC as the default in preference order', () => {
    const list = manager().list()
    expect(list.map((p) => [p.id, p.isDefault])).toEqual([['vlc', true], ['mpv', false], ['system', false]])
  })

  it('falls back to the system default when no player is installed', () => {
    expect(manager(installed()).list().filter((p) => p.isDefault).map((p) => p.id)).toEqual(['system'])
  })

  it('remembers a chosen default, refuses an unavailable one, and ignores a default that disappeared', () => {
    const m = manager()
    expect(m.setDefault('mpv').find((p) => p.isDefault)?.id).toBe('mpv')
    expect(() => m.setDefault('potplayer')).toThrow(/not available/)
    prefs = { defaultId: 'potplayer', custom: [] }
    expect(m.list().find((p) => p.isDefault)?.id).toBe('vlc')
  })

  it('adds and removes a program the person picked', () => {
    const m = manager()
    const list = m.addCustom(process.execPath)
    const custom = list.find((p) => p.kind === 'custom')!
    expect(custom).toMatchObject({ id: customPlayerId(process.execPath), removable: true, available: true })
    expect(m.addCustom(process.execPath).filter((p) => p.kind === 'custom')).toHaveLength(1)
    expect(m.remove(custom.id).some((p) => p.kind === 'custom')).toBe(false)
    expect(() => m.addCustom('notepad.exe')).toThrow()
  })

  it('starts the default player with the file and the chosen subtitle, then tells the backend', async () => {
    const result = await manager().play(7)
    expect(result).toEqual({ ok: true, code: null, message: null, playerName: 'VLC media player' })
    expect(launched).toEqual([{ exe: `${PF}\\VideoLAN\\VLC\\vlc.exe`, args: [`--sub-file=${subtitle}`, video] }])
    expect(reported).toEqual([7])
  })

  describe('with position tracking', () => {
    let tracked: { fileId: number; fileName: string; kind: string }[]
    const trackingManager = (): PlayerManager =>
      new PlayerManager({
        host: installed(`${PF}\\VideoLAN\\VLC\\vlc.exe`, `${PF}\\mpv\\mpv.exe`, process.execPath),
        getPrefs: () => prefs,
        setPrefs: (p) => void (prefs = p),
        launch: async (exe, args) => void launched.push({ exe, args }),
        openWithSystem: async (path) => {
          opened.push(path)
          return ''
        },
        fetchLaunchInfo: async () => info,
        reportLaunched: async (id) => void reported.push(id),
        track: (job) => void tracked.push({ fileId: job.fileId, fileName: job.fileName, kind: job.plan.kind }),
      })
    beforeEach(() => {
      tracked = []
    })

    it('says which players can be watched, and only when tracking is wired', () => {
      expect(trackingManager().list().map((p) => [p.id, p.tracksPosition])).toEqual([['vlc', true], ['mpv', true], ['system', false]])
      expect(manager().list().every((p) => !p.tracksPosition)).toBe(true)
    })

    it('starts the player at the remembered second with a local interface, then watches it', async () => {
      info = { ok: true, info: launchInfo({ resumeSeconds: 754, fileName: 'x.mkv' }) }
      expect(await trackingManager().play(7, 'vlc')).toMatchObject({ ok: true })
      const args = launched[0]!.args
      expect(args).toContain('--start-time=754')
      expect(args).toContain('--extraintf=http')
      expect(args.find((a) => a.startsWith('--http-host='))).toBe('--http-host=127.0.0.1')
      expect(args.find((a) => a.startsWith('--http-port='))).toMatch(/^--http-port=\d+$/)
      expect(args.find((a) => a.startsWith('--http-password='))?.length).toBeGreaterThan(20)
      expect(args[args.length - 1]).toBe(video)
      expect(tracked).toEqual([{ fileId: 7, fileName: 'x.mkv', kind: 'vlc' }])
    })

    it('uses an IPC pipe for mpv', async () => {
      await trackingManager().play(7, 'mpv')
      expect(launched[0]!.args.some((a) => a.startsWith('--input-ipc-server='))).toBe(true)
      expect(tracked.map((t) => t.kind)).toEqual(['mpv'])
    })

    it('"from the start" ignores the remembered position but is still watched', async () => {
      info = { ok: true, info: launchInfo({ resumeSeconds: 754 }) }
      await trackingManager().play(7, 'vlc', true)
      expect(launched[0]!.args.some((a) => a.startsWith('--start-time'))).toBe(false)
      expect(tracked).toHaveLength(1)
    })

    it('does not watch a player that was not started, or one that cannot be watched', async () => {
      info = { ok: false, code: 'unavailable', message: 'gone' }
      await trackingManager().play(7, 'vlc')
      info = { ok: true, info: launchInfo() }
      await trackingManager().play(7, 'system')
      expect(tracked).toEqual([])
    })

    it.each(['mpc-hc', 'mpc-be'] as const)('passes %s episode identity and process exit to tracking before reporting the launch', async (kind) => {
      const exe = kind === 'mpc-hc' ? `${PF}\\MPC-HC\\mpc-hc64.exe` : `${PF}\\MPC-BE x64\\mpc-be64.exe`
      const exited = Promise.resolve()
      const jobs: TrackJob[] = []
      info = { ok: true, info: launchInfo({ kind: 'episode', resumeSeconds: 754 }) }
      const m = new PlayerManager({
        host: installed(exe), getPrefs: () => prefs, setPrefs: () => undefined,
        fetchLaunchInfo: async () => info, openWithSystem: async () => '',
        launch: async (_exe, args) => {
          expect(args).toEqual([video, '/sub', subtitle, '/start', '754000', '/new', '/play', '/close', '/webport', expect.any(String)])
          return { exited }
        },
        track: (job) => void jobs.push(job),
        reportLaunched: async () => { expect(jobs).toHaveLength(1) },
      })
      expect(await m.play(7, kind)).toMatchObject({ ok: true })
      expect(jobs[0]).toMatchObject({ fileId: 7, fileName: 'x.mkv', filePath: video, exited, plan: { kind: 'mpc' } })
    })
  })

  it('uses the player the person picked for this one file', async () => {
    await manager().play(7, 'mpv')
    expect(launched[0]?.args).toEqual([`--sub-file=${subtitle}`, '--slang=el,en', '--', video])
  })

  it('does not pass a subtitle to a player that cannot take one', async () => {
    prefs = { defaultId: '', custom: [{ id: customPlayerId(process.execPath), name: 'node', exe: process.execPath }] }
    await manager().play(7, customPlayerId(process.execPath))
    expect(launched[0]?.args).toEqual([video])
  })

  it('opens with the system default through the OS, not as a program', async () => {
    const result = await manager(installed()).play(7)
    expect(result.ok).toBe(true)
    expect(opened).toEqual([video])
    expect(launched).toEqual([])
  })

  it('does not start anything when the backend says the file is unavailable, and says why', async () => {
    info = { ok: false, code: 'unavailable', message: 'This file is on a drive that cannot be reached right now' }
    const result = await manager().play(7)
    expect(result).toMatchObject({ ok: false, code: 'unavailable', message: expect.stringContaining('drive') })
    expect(launched).toEqual([])
    expect(reported).toEqual([])
  })

  it('refuses a path that is not a plain media file or does not exist, even if the backend sent it', async () => {
    for (const path of [join(dir, 'gone.mkv'), 'relative.mkv', 'C:\\a\\..\\b.mkv', 'C:\\Windows\\System32\\cmd.exe', '\\\\.\\PhysicalDrive0']) {
      info = { ok: true, info: launchInfo({ path }) }
      const result = await manager().play(7)
      expect(result.ok, path).toBe(false)
    }
    expect(launched).toEqual([])
  })

  it('drops an odd subtitle path but still plays the video', async () => {
    info = { ok: true, info: launchInfo({ subtitle: { path: 'C:\\x\\..\\evil.srt', language: 'el' } }) }
    await manager().play(7)
    expect(launched[0]?.args).toEqual([video])
  })

  it('reports a player that cannot be started, and an unknown or missing player', async () => {
    const failing = new PlayerManager({
      host: installed(`${PF}\\VideoLAN\\VLC\\vlc.exe`),
      getPrefs: () => prefs,
      setPrefs: () => undefined,
      launch: async () => {
        throw new Error('spawn EACCES')
      },
      openWithSystem: async () => '',
      fetchLaunchInfo: async () => info,
      reportLaunched: async () => undefined,
    })
    expect(await failing.play(7)).toMatchObject({ ok: false, code: 'launch_failed', message: 'spawn EACCES' })
    expect(await manager().play(7, 'potplayer')).toMatchObject({ ok: false, code: 'no_player' })
    expect(reported).toEqual([])
  })
})
