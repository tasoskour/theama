import { describe, expect, it } from 'vitest'
import { AsyncCache } from './cache'

describe('bounded asynchronous cache', () => {
  it('shares pending work, expires values and evicts the least recently read entry', async () => {
    let now = 0
    let calls = 0
    const cache = new AsyncCache<number>(2, 100, () => now)
    const make = async () => ++calls
    const first = cache.get('a', make)
    expect(cache.get('a', make)).toBe(first)
    await first
    await cache.get('b', make)
    expect(await cache.get('a', make)).toBe(1)
    await cache.get('c', make)
    expect(await cache.get('b', make)).toBe(4)
    now = 101
    expect(await cache.get('b', make)).toBe(5)
  })

  it('retries failed work and never repopulates a cleared cache from an old request', async () => {
    const cache = new AsyncCache<number>(2, 100)
    await expect(cache.get('a', async () => { throw new Error('offline') })).rejects.toThrow('offline')
    let finish!: (value: number) => void
    const old = cache.get('a', () => new Promise<number>(resolve => { finish = resolve }))
    await Promise.resolve()
    cache.clear()
    expect(await cache.get('a', async () => 2)).toBe(2)
    finish(1)
    await old
    expect(await cache.get('a', async () => 3)).toBe(2)
  })
})
