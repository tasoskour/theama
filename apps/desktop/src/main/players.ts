import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { win32 } from 'node:path'
import { LaunchInfo, type PlayerInfo, type PlayerKind, type PlayResult } from '@theama/contracts'
import { assertSafeUserPath, UnsafePathError } from './path-safety'
import { planTracking, TRACKED_KINDS, type TrackingPlan, type TrackJob } from './position-tracking'

export interface CustomPlayer {
  id: string
  name: string
  exe: string
}

export interface PlayerPrefs {
  defaultId: string
  custom: CustomPlayer[]
}

/** What an argument builder is given. Everything is passed to the player as separate arguments, never through a shell. */
export interface LaunchOptions {
  path: string
  subtitle: string | null
  /** Preferred subtitle languages (ISO 639-1), most wanted first. */
  languages: string[]
  /** Where to carry on (seconds); omitted or null to start at the beginning. */
  resumeSeconds?: number | null
  /** The local interface the player is asked to open so Theama can see how far it has got. */
  tracking?: TrackingPlan | null
  /** Series episodes close their MPC instance after playback. */
  closeAfterPlayback?: boolean
}

interface Definition {
  kind: Exclude<PlayerKind, 'system' | 'custom'>
  name: string
  /** Where it installs, from the environment's Program Files folders. */
  locations(env: NodeJS.ProcessEnv): string[]
  /** Command-line names to look for on PATH. */
  onPath: string[]
  externalSubtitle: boolean
  args(o: LaunchOptions): string[]
}

const programFiles = (env: NodeJS.ProcessEnv): string[] =>
  [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter((p): p is string => Boolean(p))

/** MPC-HC and MPC-BE share their switches: `/sub`, `/start <ms>` and `/webport` (which also opens the web interface). */
function mpcArgs({ path, subtitle, resumeSeconds, tracking, closeAfterPlayback }: LaunchOptions): string[] {
  return [
    path,
    ...(subtitle ? ['/sub', subtitle] : []),
    ...(resumeSeconds ? ['/start', String(resumeSeconds * 1000)] : []),
    ...(tracking?.kind === 'mpc' || closeAfterPlayback ? ['/new'] : []),
    ...(closeAfterPlayback ? ['/play', '/close'] : []),
    ...(tracking?.kind === 'mpc' ? ['/webport', String(tracking.port)] : []),
  ]
}

/**
 * The players Theama knows how to start with a subtitle. Switches are the documented ones: VLC `--sub-file`,
 * mpv `--sub-file` / `--slang` (and `--` so a file name can never be read as an option), MPC-HC/BE `/sub`.
 * PotPlayer is started on the file only: its subtitle switch is not documented well enough to rely on.
 */
const DEFINITIONS: Definition[] = [
  {
    kind: 'vlc',
    name: 'VLC media player',
    locations: (env) => programFiles(env).map((p) => win32.join(p, 'VideoLAN', 'VLC', 'vlc.exe')),
    onPath: ['vlc.exe'],
    externalSubtitle: true,
    args: ({ path, subtitle, resumeSeconds, tracking }) => [
      ...(subtitle ? [`--sub-file=${subtitle}`] : []),
      ...(resumeSeconds ? [`--start-time=${resumeSeconds}`] : []),
      // A separate instance per start, or a running VLC would take the file and never open our interface.
      ...(tracking?.kind === 'vlc'
        ? ['--no-one-instance', '--extraintf=http', '--http-host=127.0.0.1', `--http-port=${tracking.port}`, `--http-password=${tracking.password}`]
        : []),
      path,
    ],
  },
  {
    kind: 'mpc-hc',
    name: 'MPC-HC',
    locations: (env) => programFiles(env).flatMap((p) => [win32.join(p, 'MPC-HC', 'mpc-hc64.exe'), win32.join(p, 'MPC-HC', 'mpc-hc.exe'), win32.join(p, 'K-Lite Codec Pack', 'MPC-HC64', 'mpc-hc64.exe')]),
    onPath: ['mpc-hc64.exe', 'mpc-hc.exe'],
    externalSubtitle: true,
    args: mpcArgs,
  },
  {
    kind: 'mpv',
    name: 'mpv',
    locations: (env) => [
      ...programFiles(env).map((p) => win32.join(p, 'mpv', 'mpv.exe')),
      ...(env.LOCALAPPDATA ? [win32.join(env.LOCALAPPDATA, 'Programs', 'mpv', 'mpv.exe')] : []),
      ...(env.USERPROFILE ? [win32.join(env.USERPROFILE, 'scoop', 'apps', 'mpv', 'current', 'mpv.exe')] : []),
    ],
    onPath: ['mpv.exe'],
    externalSubtitle: true,
    args: ({ path, subtitle, languages, resumeSeconds, tracking }) => [
      ...(subtitle ? [`--sub-file=${subtitle}`] : []),
      ...(languages.length > 0 ? [`--slang=${languages.join(',')}`] : []),
      ...(resumeSeconds ? [`--start=${resumeSeconds}`] : []),
      ...(tracking?.kind === 'mpv' ? [`--input-ipc-server=${tracking.pipe}`] : []),
      '--',
      path,
    ],
  },
  {
    kind: 'mpc-be',
    name: 'MPC-BE',
    locations: (env) => programFiles(env).flatMap((p) => [win32.join(p, 'MPC-BE x64', 'mpc-be64.exe'), win32.join(p, 'MPC-BE', 'mpc-be.exe')]),
    onPath: ['mpc-be64.exe', 'mpc-be.exe'],
    externalSubtitle: true,
    args: mpcArgs,
  },
  {
    kind: 'potplayer',
    name: 'PotPlayer',
    locations: (env) => programFiles(env).flatMap((p) => [win32.join(p, 'DAUM', 'PotPlayer', 'PotPlayerMini64.exe'), win32.join(p, 'DAUM', 'PotPlayer', 'PotPlayerMini.exe'), win32.join(p, 'PotPlayer', 'PotPlayerMini64.exe')]),
    onPath: ['PotPlayerMini64.exe', 'PotPlayerMini.exe'],
    externalSubtitle: false,
    args: ({ path }) => [path],
  },
]

export const SYSTEM_PLAYER_ID = 'system'

export function buildArgs(kind: PlayerKind, options: LaunchOptions): string[] {
  return DEFINITIONS.find((d) => d.kind === kind)?.args(options) ?? [options.path]
}

export interface PlayerEnv {
  env: NodeJS.ProcessEnv
  exists(path: string): boolean
}

const realEnv: PlayerEnv = { env: process.env, exists: (p) => existsSync(p) }

/** Looks in the usual install folders, then on PATH. Only paths that exist are returned. */
export function detectInstalled(host: PlayerEnv = realEnv): { kind: Definition['kind']; name: string; exe: string; externalSubtitle: boolean }[] {
  const pathDirs = (host.env.PATH ?? host.env.Path ?? '').split(';').filter(Boolean)
  const found: { kind: Definition['kind']; name: string; exe: string; externalSubtitle: boolean }[] = []
  for (const d of DEFINITIONS) {
    const candidates = [...d.locations(host.env), ...pathDirs.flatMap((dir) => d.onPath.map((n) => win32.join(dir, n)))]
    const exe = candidates.find((c) => host.exists(c))
    if (exe) found.push({ kind: d.kind, name: d.name, exe, externalSubtitle: d.externalSubtitle })
  }
  return found
}

export function customPlayerId(exe: string): string {
  return `custom:${createHash('sha1').update(exe.toLowerCase()).digest('hex').slice(0, 12)}`
}

/** A program the person picked: an absolute path to an existing .exe, nothing else. */
export function validateCustomExe(raw: string): string {
  // eslint-disable-next-line no-control-regex
  if (!win32.isAbsolute(raw) || /[\u0000-\u001f]/.test(raw) || raw.split(/[\\/]+/).includes('..')) throw new UnsafePathError('That is not a full path to a program')
  if (!/\.exe$/i.test(raw)) throw new UnsafePathError('Choose a program (.exe)')
  let isFile = false
  try {
    isFile = statSync(raw).isFile()
  } catch {
    isFile = false
  }
  if (!isFile) throw new UnsafePathError('That program does not exist')
  return win32.normalize(raw)
}

export interface LaunchedPlayer {
  exited: Promise<void>
}

export interface PlayerDeps {
  host?: PlayerEnv
  getPrefs(): PlayerPrefs
  setPrefs(prefs: PlayerPrefs): void
  /** Starts a program detached with an argument array. Resolves once it has started; rejects if it could not. */
  launch(exe: string, args: string[]): Promise<LaunchedPlayer | void>
  /** Opens a file with the system default application. Returns an error message, or '' on success. */
  openWithSystem(path: string): Promise<string>
  /** Asks the backend about a file (the shell supplies the token). */
  fetchLaunchInfo(fileId: number): Promise<{ ok: true; info: LaunchInfo } | { ok: false; message: string; code: 'unavailable' | 'unreachable' }>
  /** Tells the backend a player was started. */
  reportLaunched(fileId: number): Promise<void>
  /**
   * Starts watching a player that was started with a tracking interface. Absent when position tracking is
   * not wired (tests, the end-to-end fake player): then players are started without the extra switches.
   */
  track?(job: TrackJob): void
}

/** The real "start a program": detached, no shell, no console window handling beyond the player's own. */
export function launchDetached(exe: string, args: string[]): Promise<LaunchedPlayer> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false })
    const exited = new Promise<void>((onExit) => child.once('exit', () => onExit()))
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve({ exited })
    })
  })
}

const PREFERENCE: PlayerKind[] = ['vlc', 'mpc-hc', 'mpv', 'mpc-be', 'potplayer']

export class PlayerManager {
  constructor(private readonly deps: PlayerDeps) {}

  private get host(): PlayerEnv {
    return this.deps.host ?? realEnv
  }

  private canTrack(kind: PlayerKind): boolean {
    return this.deps.track !== undefined && TRACKED_KINDS.has(kind)
  }

  list(): PlayerInfo[] {
    const prefs = this.deps.getPrefs()
    const detected = detectInstalled(this.host)
    const players: Omit<PlayerInfo, 'isDefault'>[] = [
      ...detected.map((d) => ({ id: d.kind, name: d.name, kind: d.kind, available: true, exe: d.exe, removable: false, externalSubtitle: d.externalSubtitle, tracksPosition: this.canTrack(d.kind) })),
      ...prefs.custom.map((c) => ({ id: c.id, name: c.name, kind: 'custom' as const, available: this.host.exists(c.exe), exe: c.exe, removable: true, externalSubtitle: false, tracksPosition: false })),
      { id: SYSTEM_PLAYER_ID, name: 'System default', kind: 'system', available: true, exe: null, removable: false, externalSubtitle: false, tracksPosition: false },
    ]
    const wanted = players.find((p) => p.id === prefs.defaultId && p.available)
    const fallback =
      PREFERENCE.map((k) => players.find((p) => p.id === k && p.available)).find(Boolean) ?? players.find((p) => p.id === SYSTEM_PLAYER_ID)!
    const chosen = wanted ?? fallback
    return players.map((p) => ({ ...p, isDefault: p.id === chosen.id }))
  }

  setDefault(id: string): PlayerInfo[] {
    if (!this.list().some((p) => p.id === id && p.available)) throw new Error('That player is not available')
    this.deps.setPrefs({ ...this.deps.getPrefs(), defaultId: id })
    return this.list()
  }

  addCustom(exeRaw: string): PlayerInfo[] {
    const exe = validateCustomExe(exeRaw)
    const prefs = this.deps.getPrefs()
    const id = customPlayerId(exe)
    if (!prefs.custom.some((c) => c.id === id)) {
      const name = win32.basename(exe, win32.extname(exe))
      this.deps.setPrefs({ ...prefs, custom: [...prefs.custom, { id, name, exe }] })
    }
    return this.list()
  }

  remove(id: string): PlayerInfo[] {
    const prefs = this.deps.getPrefs()
    this.deps.setPrefs({ defaultId: prefs.defaultId === id ? '' : prefs.defaultId, custom: prefs.custom.filter((c) => c.id !== id) })
    return this.list()
  }

  /** Starts a player on a library file. The path comes from the backend, never from the caller. */
  async play(fileId: number, playerId?: string, fromStart = false): Promise<PlayResult> {
    const fail = (code: NonNullable<PlayResult['code']>, message: string, playerName: string | null = null): PlayResult => ({ ok: false, code, message, playerName })

    const players = this.list()
    const player = playerId ? players.find((p) => p.id === playerId && p.available) : players.find((p) => p.isDefault)
    if (!player) return fail('no_player', 'That player is not available on this PC')

    const looked = await this.deps.fetchLaunchInfo(fileId)
    if (!looked.ok) return fail(looked.code, looked.message, player.name)
    const info = looked.info

    let path: string
    let subtitle: string | null = null
    let tracking: TrackingPlan | null = null
    let launched: LaunchedPlayer | void = undefined
    try {
      path = assertSafeUserPath(info.path)
      if (info.subtitle && player.externalSubtitle) {
        try {
          subtitle = assertSafeUserPath(info.subtitle.path)
        } catch {
          subtitle = null // an odd subtitle path is dropped; the video still plays
        }
      }
    } catch (err) {
      return fail('unavailable', err instanceof UnsafePathError ? err.message : 'This file cannot be opened', player.name)
    }

    try {
      if (player.kind === 'system') {
        const error = await this.deps.openWithSystem(path)
        if (error) return fail('launch_failed', error, player.name)
      } else {
        tracking = this.canTrack(player.kind) ? await planTracking(player.kind) : null
        const resumeSeconds = fromStart ? null : info.resumeSeconds
        launched = await this.deps.launch(player.exe!, buildArgs(player.kind, {
          path, subtitle, languages: info.subtitleLanguages, resumeSeconds, tracking, closeAfterPlayback: info.kind === 'episode',
        }))
      }
    } catch (err) {
      return fail('launch_failed', err instanceof Error ? err.message : 'The player could not be started', player.name)
    }
    if (tracking) this.deps.track?.({ fileId, fileName: info.fileName, filePath: path, plan: tracking, exited: launched?.exited })
    await this.deps.reportLaunched(fileId).catch(() => undefined)
    return { ok: true, code: null, message: null, playerName: player.name }
  }
}
