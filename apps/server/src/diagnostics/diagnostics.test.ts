import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GOOD_KEY, startFakeTmdb, type FakeTmdb } from '../../../../tools/fake-tmdb/server.mjs'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'
import { redact } from './report'

let dir: string
let fake: FakeTmdb
let server: RunningServer
let base: string
const auth = () => ({ Authorization: `Bearer ${server.token}` })
const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const report = async () => (await fetch(`${base}/diagnostics/report`, { headers: auth() })).text()

beforeAll(async () => {
  fake = await startFakeTmdb()
  dir = mkdtempSync(join(tmpdir(), 'theama-diag-'))
  server = await startServer(
    loadConfig({ THEAMA_DATA_DIR: dir, THEAMA_PORT: '0', THEAMA_FFPROBE: 'none', THEAMA_TMDB_API_BASE: fake.url, THEAMA_TMDB_IMAGE_BASE: fake.imageUrl }),
  )
  base = `http://127.0.0.1:${server.port}/api/v1`
})
afterAll(async () => {
  await server.stop('test finished')
  await fake.close()
  await rm(dir, { recursive: true, force: true })
})

describe('redact', () => {
  it('hides secrets wherever they appear, and ignores empty or tiny ones', () => {
    expect(redact('key=abcdef123456 and again abcdef123456', ['abcdef123456'])).toBe('key=[hidden] and again [hidden]')
    expect(redact('a b c', ['a', null, ''])).toBe('a b c')
  })
})

describe('interface errors', () => {
  it('are written to the log history with where they happened', async () => {
    const res = await post('/diagnostics/client-error', { kind: 'vue', message: 'Cannot read properties of undefined', stack: 'at Foo (foo.vue:1)', where: '/title' })
    expect(res.status).toBe(202)
    const logs = (await (await fetch(`${base}/logs?q=interface%20reported&level=error`, { headers: auth() })).json()) as { items: { message: string; context?: Record<string, unknown> }[] }
    expect(logs.items[0]?.message).toContain('Cannot read properties of undefined')
    expect(logs.items[0]?.context).toMatchObject({ source: 'ui', kind: 'vue', where: '/title' })
  })

  it('are limited, so a render loop cannot flood the log', async () => {
    const results: boolean[] = []
    for (let i = 0; i < 40; i++) results.push(((await (await post('/diagnostics/client-error', { kind: 'error', message: `loop ${i}` })).json()) as { accepted: boolean }).accepted)
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(30)
    expect(results.at(-1)).toBe(false)
  })

  it('reject nonsense', async () => {
    expect((await post('/diagnostics/client-error', { kind: 'nope', message: 'x' })).status).toBe(400)
    expect((await post('/diagnostics/client-error', { kind: 'error', message: 'x'.repeat(600) })).status).toBe(400)
  })
})

describe('the diagnostics report', () => {
  it('is readable text with versions, state and recent problems', async () => {
    await post('/diagnostics/client-error', { kind: 'error', message: 'something odd happened' }) // may be over the limit by now; the earlier one is enough
    const text = await report()
    expect(text).toContain('Theama diagnostics report')
    expect(text).toMatch(/Version: \d/)
    expect(text).toMatch(/Database layout: v\d+/)
    expect(text).toContain('FFprobe: not found')
    expect(text).toContain('Metadata: no TMDB key')
    expect(text).toContain('== Backups ==')
    expect(text).toMatch(/daily/)
    expect(text).toContain('Cannot read properties of undefined')
  })

  it('needs the API token like everything else', async () => {
    expect((await fetch(`${base}/diagnostics/report`)).status).toBe(401)
  })

  it('never contains the API token or the TMDB key, even if a log line does', async () => {
    expect((await fetch(`${base}/metadata/credentials`, { method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ tmdbApiKey: GOOD_KEY }) })).status).toBe(200)
    // A careless log line that carries both secrets.
    server.logger.error(`leak? token=${server.token} key=${GOOD_KEY}`)
    const text = await report()
    expect(text).not.toContain(server.token)
    expect(text).not.toContain(GOOD_KEY)
  })
})
