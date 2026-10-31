import type { Award, AwardsResult, AwardsSubject } from '@theama/contracts'
import { APP_VERSION } from '../version'
import { AsyncCache } from './cache'
import { ResilientHttp, type HttpOptions } from './http'
import { ProviderError } from './provider'

export const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql'

const HOUR_MS = 60 * 60 * 1000
/** Awards change a few times a year, so a day-old answer is as good as a fresh one. */
const FRESH_MS = 24 * HOUR_MS
/** Wikidata property that holds the TMDB id of a movie, a series or a person. */
const TMDB_ID_PROPERTY: Record<AwardsSubject, string> = { movie: 'P4947', series: 'P4983', person: 'P4985' }
const MAX_ITEMS = 200

export interface AwardsOptions {
  endpoint?: string
  /** BCP-47 tag of the metadata language, e.g. `el-GR`; award names are given in it when Wikidata has them. */
  language: () => string
  http?: HttpOptions
  now?: () => number
}

interface Binding {
  awardLabel?: { value: string }
  result?: { value: string }
  date?: { value: string }
  workLabel?: { value: string }
}

/**
 * Awards and nominations from Wikidata, matched by TMDB id so no key is needed. Never part of a title's
 * stored metadata: it is asked for when the page is opened, remembered for a day, and its failures only
 * mean the awards section stays empty.
 */
export class AwardsService {
  private readonly http: ResilientHttp
  private readonly endpoint: string
  private readonly cache: AsyncCache<AwardsResult>

  constructor(private readonly options: AwardsOptions) {
    this.endpoint = options.endpoint ?? WIKIDATA_ENDPOINT
    // SPARQL answers can take a while, and Wikidata asks clients to be gentle.
    this.http = new ResilientHttp({ minIntervalMs: 300, maxRetries: 2, timeoutMs: 30_000, ...options.http })
    this.cache = new AsyncCache(256, FRESH_MS, options.now ?? Date.now)
  }

  reset(): void {
    this.http.reset()
  }

  close(): void {
    this.http.close()
  }

  async awards(subject: AwardsSubject, externalId: string): Promise<AwardsResult> {
    if (!/^\d{1,12}$/.test(externalId)) throw new ProviderError('not_found', 'Not a TMDB id')
    const names = this.names()
    return this.cache.get(`${subject}:${externalId}:${names}`, async () => {
      const url = new URL(this.endpoint)
      url.searchParams.set('query', this.query(subject, externalId, names))
      url.searchParams.set('format', 'json')
      try {
        const body = await this.http.getJson(url, { accept: 'application/sparql-results+json', 'user-agent': `Theama/${APP_VERSION} (personal media library)` })
        return summarize(bindings(body))
      } catch (err) {
        // A refused request means Wikidata is unhappy with us, never that the user's own key is wrong.
        if (err instanceof ProviderError && err.kind !== 'unavailable') throw new ProviderError('unavailable', 'Wikidata did not answer the awards request')
        throw err
      }
    })
  }

  private names(): string {
    const language = this.options.language().split('-')[0]!.toLowerCase()
    return /^[a-z]{2,3}$/.test(language) && language !== 'en' ? `${language},en` : 'en'
  }

  private query(subject: AwardsSubject, externalId: string, languages: string): string {
    const forWork = subject === 'person' ? 'OPTIONAL { ?st pq:P1686 ?work. }' : ''
    return `SELECT ?awardLabel ?result ?date ?workLabel WHERE {
  ?item wdt:${TMDB_ID_PROPERTY[subject]} "${externalId}".
  { ?item p:P166 ?st. ?st ps:P166 ?award. BIND("won" AS ?result) }
  UNION
  { ?item p:P1411 ?st. ?st ps:P1411 ?award. BIND("nominated" AS ?result) }
  OPTIONAL { ?st pq:P585 ?date. }
  ${forWork}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${languages}". }
}
LIMIT 1000`
  }
}

function bindings(body: unknown): Binding[] {
  const rows = (body as { results?: { bindings?: unknown } } | null)?.results?.bindings
  if (!Array.isArray(rows)) throw new ProviderError('unavailable', 'Wikidata sent an unexpected response')
  return rows as Binding[]
}

/** Turns SPARQL rows into counted, de-duplicated awards: a win hides the nomination for the same award and year. */
function summarize(rows: Binding[]): AwardsResult {
  const seen = new Map<string, Award>()
  for (const row of rows) {
    const name = row.awardLabel?.value.trim()
    const result = row.result?.value
    // An award Wikidata has no label for comes back as its bare id (Q123); that tells the person nothing.
    if (!name || /^Q\d+$/.test(name) || (result !== 'won' && result !== 'nominated')) continue
    const year = /^(\d{4})-/.exec(row.date?.value ?? '')?.[1]
    const work = row.workLabel?.value.trim()
    const award: Award = { name, result, year: year ? Number(year) : null, forWork: work && !/^Q\d+$/.test(work) ? work : null }
    const key = `${name}|${award.year ?? ''}|${award.forWork ?? ''}`
    const known = seen.get(key)
    if (!known || (known.result === 'nominated' && result === 'won')) seen.set(key, award)
  }
  const all = [...seen.values()].sort((a, b) => (a.result === b.result ? 0 : a.result === 'won' ? -1 : 1) || (b.year ?? -1) - (a.year ?? -1) || a.name.localeCompare(b.name))
  const wins = all.filter((a) => a.result === 'won').length
  return { wins, nominations: all.length - wins, items: all.slice(0, MAX_ITEMS) }
}
