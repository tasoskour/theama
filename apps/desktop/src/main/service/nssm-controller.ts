import { execFile } from 'node:child_process'
import { SERVICE_NAME, type ServiceAccountChoice, type ServiceActionResult, type ServiceStatus } from '@theama/contracts'
import type { ApiConnection } from '../runtime'
import { runAdmin, currentUser, type AdminAction, type AdminPaths, type AdminResult, type AdminUser } from './admin'
import { actionResult, baseStatus, waitUntil, type ServiceController } from './controller'
import { parseScAccount, parseScQuery } from './sc-parse'

export interface ScOutput {
  code: number
  output: string
}

export interface NssmDeps {
  /** Runs sc.exe with an argument array (never a shell string). */
  sc(args: string[]): Promise<ScOutput>
  /** Current API connection, if the server is listening. */
  connection(): ApiConnection | null
  probe(conn: ApiConnection): Promise<boolean>
  admin(action: AdminAction, account: ServiceAccountChoice | null): Promise<AdminResult>
  sleep?: (ms: number) => Promise<void>
}

export function runSc(args: string[]): Promise<ScOutput> {
  return new Promise((resolve) => {
    execFile('sc.exe', args, { windowsHide: true, timeout: 15_000, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
      resolve({ code, output: `${stdout}\n${stderr}` })
    })
  })
}

const ACCESS_DENIED = /\b5\b.*(?:denied|Access)|Access is denied|\b5:/i
const ALREADY_RUNNING = /\b1056\b/
const NOT_RUNNING = /\b1062\b/

/** Controls the Windows service installed by NSSM through sc.exe and the elevated admin script. */
export class NssmServiceController implements ServiceController {
  readonly kind = 'nssm' as const

  constructor(private readonly deps: NssmDeps) {}

  async status(): Promise<ServiceStatus> {
    const [query, config] = await Promise.all([
      this.deps.sc(['queryex', SERVICE_NAME]),
      this.deps.sc(['qc', SERVICE_NAME]),
    ])
    const parsed = parseScQuery(query.output, query.code)
    if (!parsed.installed && parsed.state === 'not-installed') {
      return baseStatus('nssm', { state: 'not-installed', detail: null })
    }
    if (!parsed.installed) {
      return baseStatus('nssm', {
        state: 'unknown',
        detail: ACCESS_DENIED.test(query.output)
          ? 'Windows denied access to the service. Use Repair to restore start/stop permission.'
          : query.output.trim().slice(0, 300),
      })
    }
    const conn = this.deps.connection()
    const reachable = parsed.state === 'running' && conn ? await this.deps.probe(conn) : false
    return baseStatus('nssm', {
      state: parsed.state,
      pid: parsed.pid,
      account: parseScAccount(config.output),
      apiReachable: reachable,
      detail:
        parsed.state === 'running' && !reachable
          ? 'The service is running but its API is not answering yet.'
          : null,
    })
  }

  async start(): Promise<ServiceActionResult> {
    const before = await this.status()
    if (before.state === 'not-installed') return actionResult(false, 'The service is not installed.', before)
    if (before.state === 'running' && before.apiReachable) return actionResult(true, null, before)

    if (before.state !== 'running' && before.state !== 'start-pending') {
      const r = await this.deps.sc(['start', SERVICE_NAME])
      if (r.code !== 0 && !ALREADY_RUNNING.test(r.output)) return this.failed(r, 'start')
    }
    const up = await waitUntil(async () => (await this.status()).apiReachable, 25_000, 500, this.deps.sleep)
    const after = await this.status()
    return up
      ? actionResult(true, null, after)
      : actionResult(false, 'The service did not become ready in time. Check the log history for details.', after)
  }

  async stop(): Promise<ServiceActionResult> {
    const before = await this.status()
    if (before.state === 'not-installed') return actionResult(false, 'The service is not installed.', before)
    if (before.state === 'stopped') return actionResult(true, null, before)

    const r = await this.deps.sc(['stop', SERVICE_NAME])
    if (r.code !== 0 && !NOT_RUNNING.test(r.output)) return this.failed(r, 'stop')
    const stopped = await waitUntil(async () => (await this.status()).state === 'stopped', 45_000, 500, this.deps.sleep)
    const after = await this.status()
    return stopped
      ? actionResult(true, null, after)
      : actionResult(false, 'The service did not stop within 45 seconds.', after)
  }

  async restart(): Promise<ServiceActionResult> {
    const stopped = await this.stop()
    if (!stopped.ok) return stopped
    return this.start()
  }

  async install(account: ServiceAccountChoice): Promise<ServiceActionResult> {
    return this.admin('install', account)
  }

  async repair(account: ServiceAccountChoice): Promise<ServiceActionResult> {
    return this.admin('repair', account)
  }

  async uninstall(): Promise<ServiceActionResult> {
    return this.admin('uninstall', null)
  }

  private async admin(action: AdminAction, account: ServiceAccountChoice | null): Promise<ServiceActionResult> {
    const result = await this.deps.admin(action, account)
    if (result.ok && action !== 'uninstall') {
      await waitUntil(async () => (await this.status()).apiReachable, 25_000, 500, this.deps.sleep)
    }
    return actionResult(result.ok, result.message || null, await this.status())
  }

  private async failed(r: ScOutput, verb: string): Promise<ServiceActionResult> {
    const status = await this.status()
    const message = ACCESS_DENIED.test(r.output)
      ? `Windows denied permission to ${verb} the service. Use Repair once to grant your account access.`
      : `sc.exe ${verb} failed: ${r.output.trim().slice(0, 300)}`
    return actionResult(false, message, status)
  }
}

export interface NssmControllerOptions {
  adminPaths: AdminPaths
  connection: () => ApiConnection | null
  probe: (conn: ApiConnection) => Promise<boolean>
}

/** Production wiring of the NSSM controller. */
export function createNssmController(options: NssmControllerOptions): NssmServiceController {
  let user: Promise<AdminUser> | null = null
  return new NssmServiceController({
    sc: runSc,
    connection: options.connection,
    probe: options.probe,
    admin: async (action, account) => {
      user ??= currentUser()
      return runAdmin(action, account, options.adminPaths, await user)
    },
  })
}
