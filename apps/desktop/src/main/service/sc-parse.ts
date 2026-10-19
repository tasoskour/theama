import type { ServiceState } from '@theama/contracts'

export interface ScQueryResult {
  installed: boolean
  state: ServiceState
  pid: number | null
}

const STATE_BY_CODE: Record<number, ServiceState> = {
  1: 'stopped',
  2: 'start-pending',
  3: 'stop-pending',
  4: 'running',
  5: 'start-pending', // continue pending
  6: 'stop-pending', // pause pending
  7: 'paused',
}

/** Win32 error 1060: the service does not exist. sc.exe prints it in the user's language, so the code is what we match. */
const ERROR_SERVICE_DOES_NOT_EXIST = /\b1060\b/

/**
 * Parses `sc.exe queryex <name>` output. State lines look like
 *   STATE              : 4  RUNNING
 * and are matched by numeric code, so localized Windows installs work too.
 */
export function parseScQuery(output: string, exitCode: number): ScQueryResult {
  if (exitCode !== 0 && ERROR_SERVICE_DOES_NOT_EXIST.test(output)) {
    return { installed: false, state: 'not-installed', pid: null }
  }
  const state = /^\s*(?:STATE|ΚΑΤΑΣΤΑΣΗ)\s*:\s*(\d+)/im.exec(output) ?? /:\s*(\d)\s+[A-Z_]+\s*$/m.exec(output)
  const code = state ? Number(state[1]) : NaN
  const pidMatch = /^\s*PID\s*:\s*(\d+)/im.exec(output)
  const pid = pidMatch ? Number(pidMatch[1]) : null
  if (!Number.isFinite(code)) {
    return { installed: exitCode === 0, state: 'unknown', pid: null }
  }
  return { installed: true, state: STATE_BY_CODE[code] ?? 'unknown', pid: pid && pid > 0 ? pid : null }
}

/** Extracts the account from `sc.exe qc <name>` (SERVICE_START_NAME). */
export function parseScAccount(output: string): string | null {
  const m = /SERVICE_START_NAME\s*:\s*(.+)$/im.exec(output)
  const account = m?.[1]?.trim()
  return account ? account : null
}
