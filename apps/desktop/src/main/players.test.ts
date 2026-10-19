import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { LaunchInfo } from '@theama/contracts'
import { buildArgs, customPlayerId, detectInstalled, PlayerManager, validateCustomExe, type PlayerDeps, type PlayerPrefs } from './players'

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

describe('PlayerManager', () => {
  let prefs: PlayerPrefs
  let launched: { exe: string; args: string[] }[]
  let opened: string[]
  let reported: number[]
  let info: Awaited<ReturnType<PlayerDeps['fetchLaunchInfo']>>

  const launchInfo = (over: Partial<LaunchInfo> = {}): LaunchInfo => ({
    fileId: 7, path: video, fileName: 'x.mkv', title: 'Film', kind: 'movie',
    subtitle: { path: subtitle, language: 'el' }, subtitleLanguages: ['el', 'en'], ...over,
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
