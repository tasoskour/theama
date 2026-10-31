import { expect, it, vi } from 'vitest'
import { AwardsService } from './awards'
import { ProviderError } from './provider'

const row = (awardLabel: string, result: 'won' | 'nominated', date?: string, workLabel?: string) => ({
  awardLabel: { value: awardLabel },
  result: { value: result },
  ...(date ? { date: { value: date } } : {}),
  ...(workLabel ? { workLabel: { value: workLabel } } : {}),
})

function service(rows: unknown[], language = 'en-US', now: () => number = () => 0) {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ results: { bindings: rows } }), { status: 200 }))
  return { fetch, awards: new AwardsService({ language: () => language, now, http: { fetch: fetch as unknown as typeof globalThis.fetch, minIntervalMs: 0, sleep: async () => undefined } }) }
}

it('asks Wikidata by TMDB id and counts wins and nominations, a win hiding its own nomination', async () => {
  const { awards, fetch } = service([
    row('Academy Award for Best Picture', 'won', '1995-03-27T00:00:00Z'),
    row('Academy Award for Best Picture', 'nominated', '1995-03-27T00:00:00Z'),
    row('BAFTA Award for Best Film', 'nominated', '1995-01-01T00:00:00Z'),
    row('Q123456', 'won'),
    row('Golden Globe Award for Best Motion Picture – Drama', 'won', '1995-01-21T00:00:00Z'),
  ])
  const result = await awards.awards('movie', '13')
  expect(result).toEqual({
    wins: 2,
    nominations: 1,
    items: [
      { name: 'Academy Award for Best Picture', result: 'won', year: 1995, forWork: null },
      { name: 'Golden Globe Award for Best Motion Picture – Drama', result: 'won', year: 1995, forWork: null },
      { name: 'BAFTA Award for Best Film', result: 'nominated', year: 1995, forWork: null },
    ],
  })
  const url = new URL((fetch.mock.calls[0] as unknown as [URL])[0])
  expect(url.searchParams.get('query')).toContain('wdt:P4947 "13"')
  expect(url.searchParams.get('query')).not.toContain('P1686')
})

it('uses the series and person properties, names the work for a person, and asks for labels in the metadata language', async () => {
  const { awards, fetch } = service([row('Academy Award for Best Actor', 'won', '1994-03-21T00:00:00Z', 'Philadelphia')], 'el-GR')
  const series = await awards.awards('series', '1396')
  expect(series.wins).toBe(1)
  const person = await awards.awards('person', '31')
  expect(person.items[0]).toMatchObject({ year: 1994, forWork: 'Philadelphia' })
  const queries = fetch.mock.calls.map((call) => new URL((call as unknown as [URL])[0]).searchParams.get('query'))
  expect(queries[0]).toContain('wdt:P4983 "1396"')
  expect(queries[1]).toContain('wdt:P4985 "31"')
  expect(queries[1]).toContain('pq:P1686')
  expect(queries[1]).toContain('"el,en"')
})

it('remembers an answer for a day and keeps languages apart', async () => {
  let clock = 0
  let language = 'en-US'
  const fetch = vi.fn(async () => new Response(JSON.stringify({ results: { bindings: [] } }), { status: 200 }))
  const awards = new AwardsService({ language: () => language, now: () => clock, http: { fetch: fetch as unknown as typeof globalThis.fetch, minIntervalMs: 0 } })
  await awards.awards('movie', '1')
  await awards.awards('movie', '1')
  expect(fetch).toHaveBeenCalledOnce()
  language = 'el-GR'
  await awards.awards('movie', '1')
  expect(fetch).toHaveBeenCalledTimes(2)
  clock = 24 * 60 * 60 * 1000 + 1
  await awards.awards('movie', '1')
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('reports Wikidata trouble as unavailable and refuses ids that are not numbers', async () => {
  const refused = vi.fn(async () => new Response('no', { status: 403 }))
  const awards = new AwardsService({ language: () => 'en-US', http: { fetch: refused as unknown as typeof globalThis.fetch, minIntervalMs: 0 } })
  await expect(awards.awards('movie', '1')).rejects.toMatchObject({ kind: 'unavailable' })
  await expect(awards.awards('movie', '1" } #')).rejects.toBeInstanceOf(ProviderError)
  const garbled = service([])
  garbled.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ nope: true }), { status: 200 }))
  await expect(garbled.awards.awards('movie', '2')).rejects.toMatchObject({ kind: 'unavailable' })
})
