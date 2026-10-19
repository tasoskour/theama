import { ProviderError } from './provider'

export interface HttpOptions {
  fetch?: typeof fetch
  /** Minimum spacing between requests, in ms (smooths bursts well below the provider's limit). */
  minIntervalMs?: number
  maxRetries?: number
  baseDelayMs?: number
  /** Consecutive failed calls (after retries) that pause the provider. */
  breakerThreshold?: number
  breakerCooldownMs?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  random?: () => number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The shared plumbing every provider call goes through: request spacing, retry with exponential backoff
 * and jitter (honouring Retry-After), and a circuit breaker so a provider that is down is not hammered
 * and the rest of the app keeps working from cached data.
 */
export class ResilientHttp {
  private readonly fetchImpl: typeof fetch
  private readonly minInterval: number
  private readonly maxRetries: number
  private readonly baseDelay: number
  private readonly threshold: number
  private readonly cooldown: number
  private readonly timeout: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly random: () => number
  private chain: Promise<void> = Promise.resolve()
  private nextSlot = 0
  private failures = 0
  private openUntil = 0
  private readonly shutdown = new AbortController()

  constructor(options: HttpOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch
    this.minInterval = options.minIntervalMs ?? 40
    this.maxRetries = options.maxRetries ?? 3
    this.baseDelay = options.baseDelayMs ?? 500
    this.threshold = options.breakerThreshold ?? 5
    this.cooldown = options.breakerCooldownMs ?? 60_000
    this.timeout = options.timeoutMs ?? 15_000
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
  }

  /** Cancels calls in flight and refuses new ones; used when the service is stopping. */
  close(): void {
    this.shutdown.abort()
  }

  get isOpen(): boolean {
    return this.now() < this.openUntil
  }

  /** Resets the breaker, e.g. after the user changes credentials or asks to retry. */
  reset(): void {
    this.failures = 0
    this.openUntil = 0
  }

  private async slot(): Promise<void> {
    const turn = this.chain.then(async () => {
      const wait = this.nextSlot - this.now()
      if (wait > 0) await this.sleep(wait)
      this.nextSlot = this.now() + this.minInterval
    })
    this.chain = turn.catch(() => undefined)
    await turn
  }

  async getJson(url: URL, headers: Record<string, string> = {}): Promise<unknown> {
    const res = await this.request(url, headers)
    try {
      return await res.json()
    } catch {
      throw new ProviderError('unavailable', 'The provider sent an unreadable response')
    }
  }

  async getBytes(url: URL, maxBytes: number): Promise<{ bytes: Buffer; contentType: string }> {
    const res = await this.request(url, {})
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > maxBytes) throw new ProviderError('unavailable', 'The image is larger than allowed')
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > maxBytes) throw new ProviderError('unavailable', 'The image is larger than allowed')
    return { bytes, contentType: res.headers.get('content-type') ?? '' }
  }

  private async request(url: URL, headers: Record<string, string>): Promise<Response> {
    if (this.shutdown.signal.aborted) throw new ProviderError('unavailable', 'Shutting down')
    if (this.isOpen) throw new ProviderError('unavailable', 'The metadata provider is paused after repeated failures')
    let lastMessage = 'Network error'
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.slot()
      let delay = this.baseDelay * 2 ** attempt * (0.5 + this.random())
      try {
        const res = await this.fetchImpl(url, { headers, signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.timeout)]), redirect: 'error' })
        if (res.ok) {
          this.failures = 0
          return res
        }
        if (res.status === 401 || res.status === 403) throw new ProviderError('auth', 'The provider rejected the API key')
        if (res.status === 404) throw new ProviderError('not_found', 'The provider has no such record')
        lastMessage = `HTTP ${res.status}`
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after'))
          if (Number.isFinite(retryAfter) && retryAfter > 0) delay = Math.min(retryAfter * 1000, 30_000)
        } else if (res.status < 500) {
          throw new ProviderError('unavailable', lastMessage)
        }
        await res.body?.cancel().catch(() => undefined)
      } catch (err) {
        if (err instanceof ProviderError) throw err
        lastMessage = err instanceof Error ? err.message : 'Network error'
      }
      if (this.shutdown.signal.aborted) throw new ProviderError('unavailable', 'Shutting down')
      if (attempt < this.maxRetries) await this.sleep(delay)
    }
    this.failures++
    if (this.failures >= this.threshold) this.openUntil = this.now() + this.cooldown
    throw new ProviderError('unavailable', lastMessage)
  }
}
