import { describe, expect, it } from 'vitest'
import { ProwlarrClient } from './prowlarr'

function client(handler: (method: string, url: string, body: unknown) => unknown, posts: unknown[] = []): ProwlarrClient {
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (method === 'POST') posts.push(body)
    const out = handler(method, url, body)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out), { status: 200 })
  }) as typeof fetch
  return new ProwlarrClient(() => ({ url: 'http://localhost:9696', apiKey: 'abcdefgh' }), { fetch: fetchImpl })
}

describe('addRecommendedIndexers', () => {
  const schema = [{ definitionName: 'thepiratebay', name: 'The Pirate Bay', fields: [] }, { definitionName: 'yts', name: 'YTS', fields: [] }]
  const route = (existing: unknown[]) => (_m: string, url: string): unknown => {
    if (url.endsWith('/indexer/schema')) return schema
    if (url.endsWith('/appprofile')) return [{ id: 7 }]
    if (url.endsWith('/indexer')) return existing
    return {}
  }

  it('adds both indexers with the first app profile', async () => {
    const posts: Array<Record<string, unknown>> = []
    const result = await client(route([]), posts).addRecommendedIndexers()
    expect(result).toEqual({ added: ['The Pirate Bay', 'YTS'], existing: [], failed: [] })
    expect(posts[0]).toMatchObject({ enable: true, appProfileId: 7, definitionName: 'thepiratebay' })
  })

  it('skips what is already there and reports failures per indexer', async () => {
    const posts: unknown[] = []
    const result = await client((m, url) => (m === 'POST' ? new Response('bad', { status: 400 }) : route([{ definitionName: 'yts' }])(m, url)), posts).addRecommendedIndexers()
    expect(result.existing).toEqual(['YTS'])
    expect(result.added).toEqual([])
    expect(result.failed[0]).toMatchObject({ name: 'The Pirate Bay' })
  })
})
