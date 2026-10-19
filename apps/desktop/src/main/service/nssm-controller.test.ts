import { describe, expect, it, vi } from 'vitest'
import type { ApiConnection } from '../runtime'
import { NssmServiceController, type NssmDeps, type ScOutput } from './nssm-controller'

const RUNNING = 'SERVICE_NAME: Theama\n        STATE              : 4  RUNNING\n        PID                : 77\n'
const STOPPED = 'SERVICE_NAME: Theama\n        STATE              : 1  STOPPED\n        PID                : 0\n'
const MISSING = '[SC] OpenService FAILED 1060:\n\nThe specified service does not exist as an installed service.\n'
const QC = '        SERVICE_START_NAME : .\\Tasos\n'
const conn: ApiConnection = { port: 1, pid: 77, token: 't', base: 'http://127.0.0.1:1', wsUrl: 'ws://127.0.0.1:1' }

/** A fake Service Control Manager holding one service in a mutable state. */
function fakeScm(initial: 'running' | 'stopped' | 'missing', options: { denyStart?: boolean } = {}) {
  let state = initial
  const calls: string[][] = []
  const sc = vi.fn(async (args: string[]): Promise<ScOutput> => {
    calls.push(args)
    const verb = args[0]
    if (verb === 'queryex') {
      if (state === 'missing') return { code: 1060, output: MISSING }
      return { code: 0, output: state === 'running' ? RUNNING : STOPPED }
    }
    if (verb === 'qc') return { code: state === 'missing' ? 1060 : 0, output: QC }
    if (verb === 'start') {
      if (options.denyStart) return { code: 5, output: '[SC] StartService FAILED 5:\n\nAccess is denied.\n' }
      state = 'running'
      return { code: 0, output: '' }
    }
    if (verb === 'stop') {
      if (state !== 'running') return { code: 1062, output: 'FAILED 1062: The service has not been started.' }
      state = 'stopped'
      return { code: 0, output: '' }
    }
    return { code: 1, output: 'unexpected' }
  })
  return { sc, calls, setState: (s: typeof state) => (state = s), get state() { return state } }
}

function controller(scm: ReturnType<typeof fakeScm>, over: Partial<NssmDeps> = {}) {
  return new NssmServiceController({
    sc: scm.sc,
    connection: () => (scm.state === 'running' ? conn : null),
    probe: async () => scm.state === 'running',
    admin: async () => ({ ok: true, message: 'done' }),
    sleep: async () => undefined,
    ...over,
  })
}

describe('NssmServiceController.status', () => {
  it('reports not-installed from error 1060', async () => {
    const s = await controller(fakeScm('missing')).status()
    expect(s).toMatchObject({ state: 'not-installed', host: 'nssm', apiReachable: false })
  })

  it('reports a running service with pid, account and API reachability', async () => {
    const s = await controller(fakeScm('running')).status()
    expect(s).toMatchObject({ state: 'running', pid: 77, account: '.\\Tasos', apiReachable: true, detail: null })
  })

  it('flags a running service whose API is silent', async () => {
    const scm = fakeScm('running')
    const s = await controller(scm, { probe: async () => false }).status()
    expect(s.state).toBe('running')
    expect(s.apiReachable).toBe(false)
    expect(s.detail).toMatch(/not answering/)
  })
})

describe('NssmServiceController actions', () => {
  it('starts a stopped service and waits for the API', async () => {
    const scm = fakeScm('stopped')
    const r = await controller(scm).start()
    expect(r.ok).toBe(true)
    expect(scm.calls.some((a) => a[0] === 'start')).toBe(true)
    expect(r.status.state).toBe('running')
  })

  it('does nothing when already running', async () => {
    const scm = fakeScm('running')
    const r = await controller(scm).start()
    expect(r.ok).toBe(true)
    expect(scm.calls.some((a) => a[0] === 'start')).toBe(false)
  })

  it('explains access denied and points at Repair', async () => {
    const r = await controller(fakeScm('stopped', { denyStart: true })).start()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Repair/)
  })

  it('refuses to start a service that is not installed', async () => {
    const r = await controller(fakeScm('missing')).start()
    expect(r).toMatchObject({ ok: false })
    expect(r.message).toMatch(/not installed/)
  })

  it('stops, and treats an already stopped service as success', async () => {
    const scm = fakeScm('running')
    const c = controller(scm)
    expect((await c.stop()).ok).toBe(true)
    expect(scm.state).toBe('stopped')
    expect((await c.stop()).ok).toBe(true)
  })

  it('restarts by stopping then starting', async () => {
    const scm = fakeScm('running')
    const r = await controller(scm).restart()
    expect(r.ok).toBe(true)
    expect(scm.calls.map((a) => a[0]).filter((v) => v === 'stop' || v === 'start')).toEqual(['stop', 'start'])
  })

  it('delegates install/repair/uninstall to the elevated admin helper and reports its message', async () => {
    const admin = vi.fn(async () => ({ ok: false, message: 'Administrator permission was not granted' }))
    const r = await controller(fakeScm('missing'), { admin }).install({ kind: 'current-user' })
    expect(admin).toHaveBeenCalledWith('install', { kind: 'current-user' })
    expect(r).toMatchObject({ ok: false, message: 'Administrator permission was not granted' })
    await controller(fakeScm('running'), { admin }).uninstall()
    expect(admin).toHaveBeenLastCalledWith('uninstall', null)
  })
})
