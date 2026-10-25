import { onScopeDispose } from 'vue'

/** Cancels a replaced read and ignores late successes/errors even if a transport ignores abort. */
export function useLatestRequest() {
  let controller: AbortController | undefined
  let disposed = false
  onScopeDispose(() => { disposed = true; controller?.abort() })
  const run = async <T>(request: (signal: AbortSignal) => Promise<T>, success: (value: T) => void, failure?: (error: unknown) => void): Promise<void> => {
    if (disposed) return
    controller?.abort()
    const current = new AbortController()
    controller = current
    try {
      const value = await request(current.signal)
      if (!disposed && !current.signal.aborted) success(value)
    } catch (err) {
      if (!disposed && !current.signal.aborted) failure?.(err)
    }
  }
  return Object.assign(run, { cancel: () => controller?.abort() })
}

/** Coalesces invalidations and never overlaps a loader, including changes received during a request. */
export function useRefresh(load: () => Promise<void>, delay = 100) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let dirty = false
  let disposed = false

  async function run(): Promise<void> {
    if (disposed) return
    if (running) { dirty = true; return }
    running = true
    try { await load() } finally {
      running = false
      if (dirty && !disposed) { dirty = false; schedule() }
    }
  }
  function schedule(): void {
    if (disposed) return
    clearTimeout(timer)
    timer = setTimeout(() => { void run() }, delay)
  }
  onScopeDispose(() => { disposed = true; clearTimeout(timer) })
  return { schedule, run }
}
