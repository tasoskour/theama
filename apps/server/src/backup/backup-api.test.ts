import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BackupInfo, BackupList, CollectionDetail, LibraryStatus, TitlePage } from '@theama/contracts'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from '../db/migrations'

let dir: string
let media: string
let dataDir: string
let server: RunningServer
let base: string
const auth = () => ({ Authorization: `Bearer ${server.token}` })
const get = async (path: string) => (await fetch(`${base}${path}`, { headers: auth() })).json() as Promise<unknown>
const send = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...auth(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const titles = async () => (TitlePage.parse(await get('/library/titles?limit=200')).items).map((t) => t.title).sort()
const backups = async () => BackupList.parse(await get('/backups'))

async function until<T>(what: string, probe: () => Promise<T | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await probe()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function start(): Promise<void> {
  server = await startServer(loadConfig({ THEAMA_DATA_DIR: dataDir, THEAMA_PORT: '0', THEAMA_FFPROBE: 'none' }))
  base = `http://127.0.0.1:${server.port}/api/v1`
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'theama-bkapi-'))
  dataDir = join(dir, 'data')
  media = join(dir, 'Βιβλιοθήκη')
  mkdirSync(media, { recursive: true })
  for (const f of ['Alpha.2001.mkv', 'Beta.2002.mkv']) writeFileSync(join(media, f), 'x')
  await start()
  expect((await send('POST', '/library/sources', { path: media, libraryType: 'movies' })).status).toBe(201)
  await until('scan', async () => !LibraryStatus.parse(await get('/library/status')).scanning && (await titles()).length === 2)
})
afterAll(async () => {
  await server.stop('test finished')
  await rm(dir, { recursive: true, force: true })
})

describe('backups through the API', () => {
  it('starts with the daily backup Theama makes on its own', async () => {
    const list = await backups()
    expect(list.items.map((b) => b.kind)).toEqual(['daily'])
    expect(list.pending).toBeNull()
    expect(list.directory).toBe(join(dataDir, 'backups'))
  })

  it('makes a manual backup, lists it, and deletes it on request', async () => {
    const res = await send('POST', '/backups')
    expect(res.status).toBe(201)
    const made = BackupInfo.parse(await res.json())
    expect(made).toMatchObject({ kind: 'manual', schemaVersion: LATEST_SCHEMA_VERSION })
    expect((await backups()).items[0]?.name).toBe(made.name)
    expect((await send('DELETE', `/backups/${made.name}`)).status).toBe(200)
    expect((await send('DELETE', `/backups/${made.name}`)).status).toBe(404)
    expect((await send('DELETE', '/backups/..%5C..%5Ctheama.db')).status).toBe(404)
  })

  it('refuses things that are not backups, and says why', async () => {
    writeFileSync(join(dir, 'junk.db'), 'junk')
    const junk = await send('POST', '/backups/restore', { path: join(dir, 'junk.db') })
    expect(junk.status).toBe(422)
    expect(((await junk.json()) as { error: { code: string } }).error.code).toBe('invalid_backup')
    expect((await send('POST', '/backups/restore', { path: 'relative.db' })).status).toBe(400)
    expect((await send('POST', '/backups/restore', { name: 'nope.db' })).status).toBe(404)
    expect((await send('POST', '/backups/restore', {})).status).toBe(400)
    expect((await send('POST', '/backups/restore', { name: 'a', path: 'b' })).status).toBe(400)

    const newer = join(dir, 'newer.db')
    const db = new Database(newer)
    for (const sql of MIGRATIONS) db.exec(sql)
    db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    db.close()
    const res = await send('POST', '/backups/restore', { path: newer })
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('newer_version')
    expect((await backups()).pending).toBeNull()
  })

  it('a staged restore waits, can be cancelled, and changes nothing until the service restarts', async () => {
    const made = BackupInfo.parse(await (await send('POST', '/backups')).json())
    const staged = BackupList.parse(await (await send('POST', '/backups/restore', { name: made.name })).json())
    expect(staged.pending).toMatchObject({ source: made.name, summary: { files: 2, titles: 2 } })
    expect(await titles()).toEqual(['Alpha', 'Beta'])
    expect((await backups()).pending?.source).toBe(made.name)
    expect(BackupList.parse(await (await send('DELETE', '/backups/restore')).json()).pending).toBeNull()
  })
})

describe('restoring for real', () => {
  it('after a restart the library is what the backup held, and what was replaced is kept', async () => {
    // Back up the library as it is now: Alpha and Beta, plus a collection of the person's own.
    const key = (TitlePage.parse(await get('/library/titles?limit=200')).items.find((t) => t.title === 'Alpha'))!.key
    expect((await send('POST', '/collections', { name: 'Keep me', key })).status).toBe(201)
    const made = BackupInfo.parse(await (await send('POST', '/backups')).json())

    // Then things change: a third film arrives, and the collection is deleted.
    writeFileSync(join(media, 'Gamma.2003.mkv'), 'x')
    await send('POST', '/library/sources/1/scan')
    await until('Gamma', async () => (await titles()).includes('Gamma'))
    const collections = (await get('/collections?kind=user')) as { items: { id: number }[] }
    await send('DELETE', `/collections/${collections.items[0]!.id}`)

    // Ask for the restore, restart (what the app does after asking), and look again.
    expect((await send('POST', '/backups/restore', { name: made.name })).status).toBe(200)
    await server.stop('restart for restore')
    await start()

    expect(await titles()).toEqual(['Alpha', 'Beta']) // Gamma was not in the backup; it is found again by the next scan
    const mine = (await get('/collections?kind=user')) as { items: { id: number; name: string }[] }
    expect(mine.items.map((c) => c.name)).toEqual(['Keep me'])
    expect(CollectionDetail.parse(await get(`/collections/${mine.items[0]!.id}`)).members).toHaveLength(1)

    const list = await backups()
    expect(list.pending).toBeNull()
    expect(list.items.some((b) => b.kind === 'pre-restore')).toBe(true) // the state that was replaced
    // And the library works afterwards: a rescan brings Gamma back.
    await send('POST', '/library/sources/1/scan')
    await until('Gamma again', async () => (await titles()).includes('Gamma'))
  })
})

describe('upgrading an old database', () => {
  it('keeps a copy of it as it was before changing its layout', async () => {
    await server.stop('swap data folder')
    const old = join(dir, 'upgrade')
    mkdirSync(join(old, 'data'), { recursive: true })
    const db = new Database(join(old, 'data', 'theama.db'))
    db.pragma('journal_mode = WAL')
    for (let v = 0; v < 4; v++) db.exec(MIGRATIONS[v]!)
    db.pragma('user_version = 4')
    db.prepare("INSERT INTO library_source (path, library_type, recursive, enabled, availability, created_at) VALUES ('D:\\Old', 'auto', 1, 1, 'unknown', 'x')").run()
    db.close()

    dataDir = old
    await start()
    const names = readdirSync(join(old, 'backups'))
    const pre = names.find((n) => n.includes('pre-migration'))!
    expect(pre).toMatch(/-v4\.db$/)
    // The copy is the old layout with the old data, and the live database has moved on.
    const copy = new Database(join(old, 'backups', pre), { readonly: true })
    expect(copy.pragma('user_version', { simple: true })).toBe(4)
    expect((copy.prepare('SELECT COUNT(*) AS n FROM library_source').get() as { n: number }).n).toBe(1)
    copy.close()
    const list = await backups()
    expect(list.items.find((b) => b.kind === 'pre-migration')).toMatchObject({ schemaVersion: 4 })
    expect(((await get('/system/info')) as { schemaVersion: number }).schemaVersion).toBe(LATEST_SCHEMA_VERSION)
  })
})
