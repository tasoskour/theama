/** Bounded LRU with expiry and one producer per key. Rejections are never cached. */
export class AsyncCache<T> {
  private readonly values = new Map<string, { value: T; until: number }>()
  private readonly pending = new Map<string, Promise<T>>()
  private generation = 0

  constructor(private readonly capacity: number, private readonly ttl: number, private readonly now: () => number = Date.now) {}

  get(key: string, produce: () => Promise<T>): Promise<T> {
    const now = this.now()
    for (const [id, entry] of this.values) if (entry.until <= now) this.values.delete(id)
    const known = this.values.get(key)
    if (known) {
      this.values.delete(key)
      this.values.set(key, known)
      return Promise.resolve(known.value)
    }
    const pending = this.pending.get(key)
    if (pending) return pending
    const generation = this.generation
    const result = Promise.resolve().then(produce).then(value => {
      if (generation === this.generation) {
        this.values.set(key, { value, until: this.now() + this.ttl })
        while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value!)
      }
      return value
    }).finally(() => { if (this.pending.get(key) === result) this.pending.delete(key) })
    this.pending.set(key, result)
    return result
  }

  clear(): void {
    this.generation++
    this.values.clear()
    this.pending.clear()
  }
}
