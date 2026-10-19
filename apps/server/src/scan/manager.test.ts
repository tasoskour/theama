import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'node:fs'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_SUMMARY, type ServerEvent } from '@theama/contracts'
import { openDatabase, type DbHandle } from '../db/client'
import { LibrarySourceRepo } from '../library/sources'
import { AutoScanner } from './auto'
import { ScanManager } from './manager'
import type { runScan, ScanContext } from './scanner'
import { MediaFileRepo, ScanJobRepo } from './store'

const logger = pino({ level: 'silent' })

let handle: DbHandle
let library: LibrarySourceRepo
let jobs: ScanJobRepo
let events: ServerEvent[]

beforeEach(() => {
  handle = openDatabase(':memory:')
  library = new LibrarySourceRepo(handle.db)
  jobs = new ScanJobRepo(handle.db)
  events = []
})
afterEach(() => handle.close())

const src = (n: number) => library.create({ path: `D:\\Media${n}`, libraryType: 'auto', recursive: true, volumeId: '1' })

/** A scan that finishes when told to, and honours cancellation like the real one. */
function controllableScan() {
  const started: number[] = []
  const gates = new Map<number, () => void>()
  const scan: typeof runScan = (ctx: ScanContext) =>
    new Promise((resolve) => {
      started.push(ctx.source.id)
      const finish = () => resolve({ status: ctx.isCancelled() ? 'cancelled' : 'done', summary: { ...EMPTY_SUMMARY, found: 3 }, diagnostics: [] })
      gates.set(ctx.source.id, finish)
      const poll = setInterval(() => {
        if (ctx.isCancelled()) {
          clearInterval(poll)
          finish()
        }
      }, 5)
      gates.set(ctx.source.id, () => {
        clearInterval(poll)
        finish()
      })
    })
  return { scan, started, release: (id: number) => gates.get(id)?.() }
}

function manager(scan: typeof runScan) {
  return new ScanManager({
    library,
    files: new MediaFileRepo(handle.db, handle.raw),
    jobs,
    probe: null,
    emit: (e) => events.push(e),
    logger,
    scan,
  })
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('ScanManager', () => {
  it('runs a queued scan, persists it and announces start, finish and a library change', async () => {
    const c = controllableScan()
    const m = manager(c.scan)
    const s = src(1)
    const job = m.enqueue(s.id, 'test')!
    await tick()
    expect(jobs.get(job.id)).toMatchObject({ status: 'running' })
    expect(m.scanning).toBe(true)
    c.release(s.id)
    await m.whenIdle()
    expect(jobs.get(job.id)).toMatchObject({ status: 'done', summary: { found: 3 } })
    expect(events.map((e) => e.type)).toEqual(['scan.started', 'scan.finished', 'library.changed'])
    expect(m.scanning).toBe(false)
  })

  it('runs one scan at a time, in order', async () => {
    const c = controllableScan()
    const m = manager(c.scan)
    const a = src(1)
    const b = src(2)
    m.enqueue(a.id, 'test')
    m.enqueue(b.id, 'test')
    await tick()
    expect(c.started).toEqual([a.id])
    c.release(a.id)
    await tick()
    expect(c.started).toEqual([a.id, b.id])
    c.release(b.id)
    await m.whenIdle()
  })

  it('does not queue a second job for a folder that is already waiting', async () => {
    const c = controllableScan()
    const m = manager(c.scan)
    const a = src(1)
    const b = src(2)
    m.enqueue(a.id, 'test') // starts running
    await tick()
    const first = m.enqueue(b.id, 'test')!
    const again = m.enqueue(b.id, 'test again')!
    expect(again.id).toBe(first.id)
    c.release(a.id)
    await tick()
    c.release(b.id)
    await m.whenIdle()
  })

  it('cancels a queued job without running it', async () => {
    const c = controllableScan()
    const m = manager(c.scan)
    const a = src(1)
    const b = src(2)
    m.enqueue(a.id, 'test')
    await tick()
    const queued = m.enqueue(b.id, 'test')!
    expect(m.cancel(queued.id)).toBe(true)
    expect(jobs.get(queued.id)).toMatchObject({ status: 'cancelled' })
    c.release(a.id)
    await m.whenIdle()
    expect(c.started).toEqual([a.id])
  })

  it('cancels a running scan', async () => {
    const c = controllableScan()
    const m = manager(c.scan)
    const a = src(1)
    const job = m.enqueue(a.id, 'test')!
    await tick()
    expect(m.cancel(job.id)).toBe(true)
    await m.whenIdle()
    expect(jobs.get(job.id)).toMatchObject({ status: 'cancelled' })
  })

  it('records a crashing scan as failed and keeps going', async () => {
    const m = manager(async () => {
      throw new Error('disk exploded')
    })
    const job = m.enqueue(src(1).id, 'test')!
    await m.whenIdle()
    expect(jobs.get(job.id)).toMatchObject({ status: 'failed', diagnostics: ['disk exploded'] })
  })

  it('skips a job whose folder was removed while it waited', async () => {
    const c = controllableScan()
    const m = manager(c.scan)
    const a = src(1)
    const b = src(2)
    m.enqueue(a.id, 'test')
    await tick()
    m.enqueue(b.id, 'test')
    m.cancelForSource(b.id)
    library.remove(b.id)
    c.release(a.id)
    await m.whenIdle()
    expect(c.started).toEqual([a.id])
  })

  it('marks scans cut off by a restart as failed and reports which folders to scan again', () => {
    const a = src(1)
    const running = jobs.create(a.id)
    jobs.setRunning(running.id, new Date().toISOString())
    const m = manager(vi.fn() as unknown as typeof runScan)
    expect(m.recoverInterrupted()).toEqual([a.id])
    expect(jobs.get(running.id)).toMatchObject({ status: 'failed' })
    expect(jobs.get(running.id)!.diagnostics[0]).toMatch(/Interrupted/)
  })

  it('refuses to queue after close', async () => {
    const m = manager(controllableScan().scan)
    await m.close()
    expect(m.enqueue(src(1).id, 'late')).toBeNull()
  })
})

describe('AutoScanner', () => {
  function fakeWatch() {
    const watchers: { path: string; fire: () => void; error: (e: Error) => void; closed: boolean }[] = []
    const watch = ((path: string, _opts: unknown, listener: () => void) => {
      const emitter = new EventEmitter() as unknown as FSWatcher
      const entry = { path, fire: () => listener(), error: (e: Error) => emitter.emit('error', e), closed: false }
      ;(emitter as unknown as { close: () => void }).close = () => {
        entry.closed = true
      }
      watchers.push(entry)
      return emitter
    }) as unknown as typeof import('node:fs').watch
    return { watch, watchers }
  }

  function setup(extra: Partial<ConstructorParameters<typeof AutoScanner>[0]> = {}) {
    const enqueue = vi.fn()
    const fake = fakeWatch()
    const auto = new AutoScanner({
      library,
      manager: { enqueue } as unknown as ScanManager,
      logger,
      watch: fake.watch,
      debounceMs: 10,
      pollMs: 3_600_000,
      ...extra,
    })
    return { auto, enqueue, fake }
  }

  it('scans every enabled folder at service start and watches the online ones', async () => {
    const a = src(1)
    const b = src(2)
    handle.raw.prepare('UPDATE library_source SET enabled = 0 WHERE id = ?').run(b.id)
    const { auto, enqueue, fake } = setup({ refresh: async () => library.list().map((s) => ({ ...s, availability: 'online' as const })) })
    auto.start()
    await auto.tick()
    expect(enqueue.mock.calls.map((c) => c[0])).toEqual([a.id])
    expect(fake.watchers.map((w) => w.path)).toEqual([a.path])
    auto.stop()
    expect(fake.watchers[0]!.closed).toBe(true)
  })

  it('queues a scan when a folder comes back online, and not while it stays offline', async () => {
    const a = src(1)
    handle.raw.prepare("UPDATE library_source SET availability = 'offline' WHERE id = ?").run(a.id)
    let availability: 'offline' | 'online' = 'offline'
    const { auto, enqueue, fake } = setup({
      refresh: async () => library.list().map((s) => ({ ...s, availability })),
    })
    auto.start() // 'service start' scan is requested for every enabled folder
    await auto.tick()
    enqueue.mockClear()
    await auto.tick()
    expect(enqueue).not.toHaveBeenCalled()
    expect(fake.watchers).toHaveLength(0) // nothing to watch on an unplugged drive

    availability = 'online'
    await auto.tick()
    expect(enqueue).toHaveBeenCalledWith(a.id, 'folder is back online')
    expect(fake.watchers).toHaveLength(1)
    auto.stop()
  })

  it('turns a burst of file events into one scan', async () => {
    const a = src(1)
    const { auto, enqueue, fake } = setup({ refresh: async () => library.list().map((s) => ({ ...s, availability: 'online' as const })) })
    auto.start()
    await auto.tick()
    enqueue.mockClear()
    for (let i = 0; i < 20; i++) fake.watchers[0]!.fire()
    await tick(60)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(a.id, 'files changed')
    auto.stop()
  })

  it('drops a watcher that errors (unplugged drive) and re-attaches on the next poll', async () => {
    src(1)
    const { auto, fake } = setup({ refresh: async () => library.list().map((s) => ({ ...s, availability: 'online' as const })) })
    auto.start()
    await auto.tick()
    fake.watchers[0]!.error(new Error('EPERM'))
    expect(auto.watchedCount).toBe(0)
    await auto.tick()
    expect(auto.watchedCount).toBe(1)
    auto.stop()
  })

  it('stops watching a folder that is disabled or removed', async () => {
    const a = src(1)
    const { auto, fake } = setup({ refresh: async () => library.list().map((s) => ({ ...s, availability: 'online' as const })) })
    auto.start()
    await auto.tick()
    expect(auto.watchedCount).toBe(1)
    library.update(a.id, { enabled: false })
    auto.syncWatchers(library.list().map((s) => ({ ...s, availability: 'online' as const })))
    expect(auto.watchedCount).toBe(0)
    expect(fake.watchers[0]!.closed).toBe(true)
    auto.stop()
  })
})
