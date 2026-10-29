import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { win32 } from 'node:path'
import { LaunchInfo, type NextUpOffer, type PlayerInfo, type PlayerKind, type PlayResult, type ProgressResult } from '@theama/contracts'
import { assertSafeUserPath, UnsafePathError } from './path-safety'
import { planTracking, TRACKED_KINDS, type TrackingPlan, type TrackJob, type PlaybackTracker } from './position-tracking'
import type { MpcBridge } from './mpc-bridge'
import { loadInPlayer, playerMatches } from './player-control'

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
  /** Keep tracked series players available for loading the next episode. */
  series?: boolean
  mpcSlave?: string
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
function mpcArgs({ path, subtitle, resumeSeconds, tracking, series, mpcSlave }: LaunchOptions): string[] {
  return [
    path,
    ...(subtitle ? ['/sub', subtitle] : []),
    ...(resumeSeconds ? ['/start', String(resumeSeconds * 1000)] : []),
    ...(tracking?.kind === 'mpc' ? ['/new'] : []),
    ...(series ? ['/play'] : []),
    ...(mpcSlave ? ['/slave', mpcSlave] : []),
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
    args: ({ path, subtitle, resumeSeconds, tracking, series }) => [
      ...(subtitle ? [`--sub-file=${subtitle}`] : []),
      ...(resumeSeconds ? [`--start-time=${resumeSeconds}`] : []),
      // A separate instance per start, or a running VLC would take the file and never open our interface.
      ...(tracking?.kind === 'vlc'
        ? ['--no-one-instance', '--extraintf=http', '--http-host=127.0.0.1', `--http-port=${tracking.port}`, `--http-password=${tracking.password}`]
        : []),
      ...(series && tracking?.kind === 'vlc' ? ['--no-play-and-exit'] : []),
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
    args: ({ path, subtitle, languages, resumeSeconds, tracking, series }) => [
      ...(subtitle ? [`--sub-file=${subtitle}`] : []),
      ...(languages.length > 0 ? [`--slang=${languages.join(',')}`] : []),
      ...(resumeSeconds ? [`--start=${resumeSeconds}`] : []),
      ...(tracking?.kind === 'mpv' ? [`--input-ipc-server=${tracking.pipe}`] : []),
      ...(series && tracking?.kind === 'mpv' ? ['--keep-open=yes'] : []),
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
  pid?: number
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
  track?(job: TrackJob): PlaybackTracker<ProgressResult | undefined> | void
  createMpcBridge?(): Promise<MpcBridge>
  loadInPlayer?: typeof loadInPlayer
  playerMatches?: typeof playerMatches
  onNextUp?(offer: NextUpOffer, playerPid?: number): void
  onNextUpCancelled?(offerId: string): void
  focusPlayer?(pid: number): Promise<void>
  autoPlayEnabled?(): Promise<boolean>
}

interface PlaybackSession {
  player: PlayerInfo
  fileId: number
  fileName: string
  filePath: string
  plan: TrackingPlan
  launched: LaunchedPlayer | void
  closed: boolean
  mpc?: MpcBridge
  tracker?: PlaybackTracker<ProgressResult | undefined>
}

/** The real "start a program": detached, no shell, no console window handling beyond the player's own. */
export function launchDetached(exe: string, args: string[]): Promise<LaunchedPlayer> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false })
    const exited = new Promise<void>((onExit) => child.once('exit', () => onExit()))
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve({ exited, pid: child.pid })
    })
  })
}

const PREFERENCE: PlayerKind[] = ['vlc', 'mpc-hc', 'mpv', 'mpc-be', 'potplayer']

export class PlayerManager {
  constructor(private readonly deps: PlayerDeps) {}

  private session?: PlaybackSession
  private offer?: { payload: NextUpOffer; session: PlaybackSession }
  private revision = 0

  cancelNext(offerId: string): void {
    if (this.offer?.payload.offerId !== offerId) return
    this.offer = undefined
    this.deps.onNextUpCancelled?.(offerId)
  }

  async playNext(offerId: string): Promise<PlayResult> {
    const offer = this.offer
    if (!offer || offer.payload.offerId !== offerId) {
      return { ok: false, code: 'unavailable', message: 'This next-episode offer has expired', playerName: null }
    }
    // Consume before any await: timer expiry, repeated clicks and EOF cannot open a second copy.
    this.offer = undefined
    const revision = this.revision
    if (this.deps.autoPlayEnabled && !await this.deps.autoPlayEnabled().catch(() => false)) {
      this.deps.onNextUpCancelled?.(offerId)
      return { ok: false, code: 'unavailable', message: 'Automatic next episode is turned off', playerName: offer.session.player.name }
    }
    return this.start(offer.payload.next.fileId, offer.session.player.id, false, revision, offer.session)
  }

  private watch(session: PlaybackSession): void {
    this.session = session
    if (session.launched) void session.launched.exited.then(() => {
      session.closed = true
      session.mpc?.close()
    })
    const tracker = this.deps.track?.({
      fileId: session.fileId, fileName: session.fileName, filePath: session.filePath, plan: session.plan,
      exited: session.launched?.exited, onEnded: session.mpc ? (listener) => session.mpc!.onEnded(listener) : undefined,
    })
    if (!tracker) return
    session.tracker = tracker
    void tracker.finished.then(({ result, reason }) => {
      if (this.session !== session || (reason !== 'ended' && reason !== 'closed') || !result?.nextUp) return
      // A file change can happen while the final report is being retried.
      if (tracker.reason && tracker.reason !== 'closed') return
      const payload = { ...result.nextUp, offerId: randomUUID() }
      this.offer = { payload, session }
      this.deps.onNextUp?.(payload, session.launched?.pid)
    })
    void tracker.done.then(() => {
      if (this.session !== session || (tracker.reason !== 'changed' && tracker.reason !== 'unavailable')) return
      if (this.offer?.session === session) this.cancelNext(this.offer.payload.offerId)
    })
  }

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
    if (this.offer) this.cancelNext(this.offer.payload.offerId)
    const previous = this.session
    this.session = undefined
    previous?.tracker?.stop()
    previous?.mpc?.close()
    return this.start(fileId, playerId, fromStart, ++this.revision)
  }

  dispose(): void {
    if (this.offer) this.cancelNext(this.offer.payload.offerId)
    this.session?.tracker?.stop()
    this.session?.mpc?.close()
    this.session = undefined
    this.revision++
  }

  private async start(fileId: number, playerId: string | undefined, fromStart: boolean, revision: number, reuse?: PlaybackSession): Promise<PlayResult> {
    const fail = (code: NonNullable<PlayResult['code']>, message: string, playerName: string | null = null): PlayResult => ({ ok: false, code, message, playerName })

    const players = this.list()
    const player = reuse?.player ?? (playerId ? players.find((p) => p.id === playerId && p.available) : players.find((p) => p.isDefault))
    if (!player) return fail('no_player', 'That player is not available on this PC')

    const looked = await this.deps.fetchLaunchInfo(fileId).catch(() => ({ ok: false as const, code: 'unreachable' as const, message: 'Playback service is unavailable' }))
    if (revision !== this.revision) return fail('unavailable', 'This playback request has expired', player.name)
    if (!looked.ok) return fail(looked.code, looked.message, player.name)
    const info = looked.info

    let path: string
    let subtitle: string | null = null
    let tracking: TrackingPlan | null = null
    let launched: LaunchedPlayer | void = undefined
    let mpc: MpcBridge | undefined
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
        tracking = reuse && !reuse.closed ? reuse.plan : this.canTrack(player.kind) ? await planTracking(player.kind) : null
        const resumeSeconds = fromStart ? null : info.resumeSeconds
        const options: LaunchOptions = { path, subtitle, languages: info.subtitleLanguages, resumeSeconds, tracking, series: info.kind === 'episode' }
        if (reuse && !reuse.closed) {
          const matches = await (this.deps.playerMatches ?? playerMatches)(reuse.plan, reuse.fileName, reuse.filePath, true)
          if (revision !== this.revision) return fail('unavailable', 'This playback request has expired', player.name)
          if (reuse.closed) return this.start(fileId, player.id, fromStart, revision)
          if (!matches) return fail('unavailable', 'The player is now playing a different file', player.name)
          reuse.tracker?.stop()
          await (this.deps.loadInPlayer ?? loadInPlayer)(reuse.plan, options, reuse.mpc)
          launched = reuse.launched
          mpc = reuse.mpc
        } else {
          if (tracking?.kind === 'mpc' && options.series) mpc = await this.deps.createMpcBridge?.().catch(() => undefined)
          if (revision !== this.revision) { mpc?.close(); return fail('unavailable', 'This playback request has expired', player.name) }
          launched = await this.deps.launch(player.exe!, buildArgs(player.kind, { ...options, mpcSlave: mpc?.slaveWindow }))
        }
      }
    } catch (err) {
      if (reuse?.closed && revision === this.revision) return this.start(fileId, player.id, fromStart, revision)
      if (!reuse) mpc?.close()
      return fail('launch_failed', err instanceof Error ? err.message : 'The player could not be started', player.name)
    }
    if (revision !== this.revision) { if (!reuse) mpc?.close(); return fail('unavailable', 'This playback request has expired', player.name) }
    if (tracking) this.watch({ player, fileId, fileName: info.fileName, filePath: path, plan: tracking, launched, closed: false, mpc })
    await this.deps.reportLaunched(fileId).catch(() => undefined)
    if (reuse && launched?.pid) await this.deps.focusPlayer?.(launched.pid).catch(() => undefined)
    return { ok: true, code: null, message: null, playerName: player.name }
  }
}
