import {
  SERVICE_NAME,
  type ServiceAccountChoice,
  type ServiceActionResult,
  type ServiceHostKind,
  type ServiceStatus,
} from '@theama/contracts'

/**
 * How the desktop shell manages the backend. The renderer only ever sees this
 * through typed IPC; which implementation runs is decided in the main process.
 */
export interface ServiceController {
  readonly kind: ServiceHostKind
  status(): Promise<ServiceStatus>
  start(): Promise<ServiceActionResult>
  stop(): Promise<ServiceActionResult>
  restart(): Promise<ServiceActionResult>
  install(account: ServiceAccountChoice): Promise<ServiceActionResult>
  repair(account: ServiceAccountChoice): Promise<ServiceActionResult>
  uninstall(): Promise<ServiceActionResult>
  /** Called on app quit; the dev controller stops its child, the NSSM one does nothing. */
  dispose?(): Promise<void>
}

export function baseStatus(host: ServiceHostKind, patch: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    host,
    state: 'unknown',
    serviceName: SERVICE_NAME,
    apiReachable: false,
    pid: null,
    account: null,
    detail: null,
    ...patch,
  }
}

export function actionResult(ok: boolean, message: string | null, status: ServiceStatus): ServiceActionResult {
  return { ok, message, status }
}

export async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 400,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await sleep(intervalMs)
  }
  return predicate()
}
