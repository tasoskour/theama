import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServiceAccountChoice } from '@theama/contracts'

export type AdminAction = 'install' | 'repair' | 'uninstall'

export interface AdminPaths {
  nssmExe: string
  nodeExe: string
  serverEntry: string
  /** Optional FFprobe location handed to the service (THEAMA_FFPROBE). */
  ffprobeExe?: string
  scriptPath: string
  dataDir: string
}

export interface AdminUser {
  /** DOMAIN\user, as printed by `whoami`. */
  name: string
  sid: string
}

export interface AdminResult {
  ok: boolean
  message: string
}

const SID_PATTERN = /^S-1-(5-21|12-1)-[\d-]+$/

export class AdminInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminInputError'
  }
}

function assertPlainValue(label: string, value: string): string {
  // Values end up inside a command line that is parsed by PowerShell: refuse
  // anything that could terminate a quoted argument or start a new command.
  // eslint-disable-next-line no-control-regex
  if (value.length === 0 || /["`$\u0000-\u001f]/.test(value)) {
    throw new AdminInputError(`${label} contains characters that are not allowed`)
  }
  return value
}

/** Single-quote a string for a PowerShell literal ('' escapes a quote). */
function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Builds the PowerShell source that starts the admin script elevated and waits
 * for it. Pure and side-effect free so the quoting rules can be unit tested.
 */
export function buildElevationCommand(
  action: AdminAction,
  account: ServiceAccountChoice | null,
  paths: AdminPaths,
  user: AdminUser,
  resultFile: string,
): string {
  if (!['install', 'repair', 'uninstall'].includes(action)) throw new AdminInputError('Unknown action')
  if (action !== 'uninstall' && !SID_PATTERN.test(user.sid)) throw new AdminInputError('Invalid user SID')
  const arg = (flag: string, value: string) => `${flag} "${assertPlainValue(flag, value)}"`
  const inner = [
    '-NoProfile',
    '-ExecutionPolicy Bypass',
    arg('-File', paths.scriptPath),
    `-Action ${action}`,
    `-Account ${account?.kind ?? 'current-user'}`,
    arg('-UserName', user.name),
    arg('-UserSid', user.sid || 'none'),
    arg('-NssmExe', paths.nssmExe),
    arg('-NodeExe', paths.nodeExe),
    arg('-ServerEntry', paths.serverEntry),
    arg('-DataDir', paths.dataDir),
    ...(paths.ffprobeExe ? [arg('-FfprobeExe', paths.ffprobeExe)] : []),
    arg('-ResultFile', resultFile),
  ].join(' ')
  return [
    "$ErrorActionPreference = 'Stop'",
    `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList ${psLiteral(inner)} -Verb RunAs -Wait -PassThru`,
    'exit $p.ExitCode',
  ].join('\n')
}

function run(file: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
      resolve({ code, stdout, stderr })
    })
  })
}

/** Looks up the interactive user's name and SID (not the elevated admin's, which may differ). */
export async function currentUser(): Promise<AdminUser> {
  const { code, stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], 10_000)
  const m = /^"([^"]+)","(S-[\d-]+)"/.exec(stdout.trim())
  if (code !== 0 || !m) throw new Error('Could not determine the current Windows user')
  return { name: m[1]!, sid: m[2]! }
}

/** Runs install/repair/uninstall elevated. The UAC prompt is shown by Windows. */
export async function runAdmin(
  action: AdminAction,
  account: ServiceAccountChoice | null,
  paths: AdminPaths,
  user: AdminUser,
  timeoutMs = 5 * 60_000,
): Promise<AdminResult> {
  for (const [label, p] of Object.entries({ script: paths.scriptPath, nssm: paths.nssmExe })) {
    if (!existsSync(p)) return { ok: false, message: `Missing ${label} file: ${p}` }
  }
  if (action !== 'uninstall') {
    for (const [label, p] of Object.entries({ 'Node.js': paths.nodeExe, 'server bundle': paths.serverEntry })) {
      if (!existsSync(p)) return { ok: false, message: `Missing ${label}: ${p}${label === 'server bundle' ? ' (build the server first)' : ''}` }
    }
  }

  const workDir = await mkdtemp(join(tmpdir(), 'theama-admin-'))
  const resultFile = join(workDir, 'result.json')
  try {
    const script = buildElevationCommand(action, account, paths, user, resultFile)
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const { code, stderr } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      timeoutMs,
    )
    try {
      const parsed = JSON.parse((await readFile(resultFile, 'utf8')).replace(/^\uFEFF/, '')) as Partial<AdminResult>
      return { ok: parsed.ok === true, message: String(parsed.message ?? '') }
    } catch {
      // No result file: the elevated script never ran to completion.
      if (/canceled by the user|cancelled by the user/i.test(stderr)) {
        return { ok: false, message: 'Administrator permission was not granted, so nothing was changed.' }
      }
      return { ok: false, message: stderr.trim() || `The elevated helper exited with code ${code} without a result.` }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
