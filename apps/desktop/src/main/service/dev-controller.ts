import { spawn, type ChildProcess } from 'node:child_process'
import type { ServiceAccountChoice, ServiceActionResult, ServiceStatus } from '@theama/contracts'
import type { ApiConnection } from '../runtime'
import { actionResult, baseStatus, waitUntil, type ServiceController } from './controller'

export interface DevControllerOptions {
  /** Directory of apps/server (cwd for the child process). */
  serverDir: string
  env: NodeJS.ProcessEnv
  connection: () => ApiConnection | null
  probe: (conn: ApiConnection) => Promise<boolean>
  /** Receives the child's stdout/stderr lines. */
  onOutput?: (line: string) => void
}

const UNSUPPORTED = 'The development process is not a Windows service. Install/repair/uninstall only apply to the NSSM service.'

/**
 * Runs the server as a plain child process, so the whole app (UI, logs, status,
 * start/stop) can be exercised without installing a Windows service.
 * Stopping is graceful: a line on the child's stdin triggers the same shutdown
 * path as NSSM's Ctrl+C, so the service history records a clean stop.
 */
export class DevProcessController implements ServiceController {
  readonly kind = 'dev-process' as const
  private child: ChildProcess | null = null

  constructor(private readonly options: DevControllerOptions) {}

  async status(): Promise<ServiceStatus> {
    const conn = this.options.connection()
    const reachable = conn ? await this.options.probe(conn) : false
    const childAlive = this.child !== null && this.child.exitCode === null
    return baseStatus('dev-process', {
      state: reachable || childAlive ? (reachable ? 'running' : 'start-pending') : 'stopped',
      pid: childAlive ? (this.child?.pid ?? null) : (conn?.pid ?? null),
      apiReachable: reachable,
      account: 'current process',
    })
  }

  async start(): Promise<ServiceActionResult> {
    const before = await this.status()
    if (before.apiReachable) return actionResult(true, null, before)
    if (!this.child || this.child.exitCode !== null) this.spawnChild()
    const up = await waitUntil(async () => (await this.status()).apiReachable, 30_000, 300)
    const after = await this.status()
    return up ? actionResult(true, null, after) : actionResult(false, 'The development server did not start in time.', after)
  }

  async stop(): Promise<ServiceActionResult> {
    const child = this.child
    if (!child || child.exitCode !== null) {
      const status = await this.status()
      return status.apiReachable
        ? actionResult(false, 'The server was started outside the app (for example by "yarn dev:server"); stop it there.', status)
        : actionResult(true, null, status)
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.stdin?.write('shutdown\n')
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000))
    if ((await Promise.race([exited.then(() => 'exited' as const), timeout])) === 'timeout') child.kill()
    this.child = null
    return actionResult(true, null, await this.status())
  }

  async restart(): Promise<ServiceActionResult> {
    const stopped = await this.stop()
    return stopped.ok ? this.start() : stopped
  }

  async install(_account: ServiceAccountChoice): Promise<ServiceActionResult> {
    return actionResult(false, UNSUPPORTED, await this.status())
  }
  async repair(_account: ServiceAccountChoice): Promise<ServiceActionResult> {
    return actionResult(false, UNSUPPORTED, await this.status())
  }
  async uninstall(): Promise<ServiceActionResult> {
    return actionResult(false, UNSUPPORTED, await this.status())
  }

  async dispose(): Promise<void> {
    await this.stop()
  }

  private spawnChild(): void {
    const child = spawn('node', ['--import', 'tsx', 'src/main.ts'], {
      cwd: this.options.serverDir,
      env: { ...process.env, ...this.options.env, THEAMA_STDIN_CONTROL: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const forward = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line) this.options.onOutput?.(line)
    }
    child.stdout?.on('data', forward)
    child.stderr?.on('data', forward)
    child.on('exit', () => {
      if (this.child === child) this.child = null
    })
    this.child = child
  }
}
