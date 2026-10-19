import { existsSync, mkdirSync, mkdtempSync, rmdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LibrarySource, LibrarySourceList } from '@theama/contracts'
import { startServer, type RunningServer } from '../bootstrap'
import { loadConfig } from '../config'
import { ApiProblem, checkAvailability, normaliseFolderPath, pathKey } from './sources'

describe('normaliseFolderPath', () => {
  it('accepts absolute paths and strips trailing separators', () => {
    expect(normaliseFolderPath('D:\\Movies\\')).toBe('D:\\Movies')
    expect(normaliseFolderPath('  D:\\Ταινίες  ')).toBe('D:\\Ταινίες')
    expect(normaliseFolderPath('D:\\')).toBe('D:\\')
    expect(normaliseFolderPath('\\\\NAS\\media\\films')).toBe('\\\\NAS\\media\\films')
  })

  it.each(['', '   ', 'Movies', '.\\Movies', 'D:\\Movies\\..\\Windows', 'D:\\a\u0000b', '\\\\.\\C:\\'])('rejects %j', (input) => {
    expect(() => normaliseFolderPath(input)).toThrow(ApiProblem)
  })
})

describe('pathKey', () => {
  it('treats case and trailing slashes as the same folder', () => {
    expect(pathKey('D:\\Movies')).toBe(pathKey('d:\\movies\\'))
    expect(pathKey('D:\\Movies')).not.toBe(pathKey('D:\\Movies2'))
  })
})

describe('checkAvailability', () => {
  it('is online when the folder answers and the volume matches', async () => {
    const r = await checkAvailability('E:\\Films', '123', async () => ({ volumeId: '123' }))
    expect(r).toEqual({ availability: 'online', volumeId: '123' })
  })
  it('is offline when the drive is unreachable', async () => {
    const r = await checkAvailability('E:\\Films', '123', async () => {
      throw new Error('ENOENT')
    })
    expect(r).toEqual({ availability: 'offline', volumeId: null })
  })
  it('is offline when a different disk is mounted at the same path', async () => {
    const r = await checkAvailability('E:\\Films', '123', async () => ({ volumeId: '999' }))
    expect(r.availability).toBe('offline')
  })
  it('trusts the folder when no volume was recorded', async () => {
    expect((await checkAvailability('E:\\Films', null, async () => ({ volumeId: '5' }))).availability).toBe('online')
  })
})

describe('library source API', () => {
  let dir: string
  let media: string
  let server: RunningServer
  let base: string
  const headers = () => ({ Authorization: `Bearer ${server.token}`, 'Content-Type': 'application/json' })
  const json = async (res: Response) => (await res.json()) as any // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'theama-lib-'))
    media = join(dir, 'Movies Ταινίες')
    mkdirSync(media)
    writeFileSync(join(dir, 'not-a-folder.txt'), 'x')
    server = await startServer(loadConfig({ THEAMA_DATA_DIR: join(dir, 'data'), THEAMA_PORT: '0' }))
    base = `http://127.0.0.1:${server.port}/api/v1/library/sources`
  })
  afterAll(async () => {
    await server.stop('test finished')
    await rm(dir, { recursive: true, force: true })
  })

  it('starts empty', async () => {
    expect(LibrarySourceList.parse(await json(await fetch(base, { headers: headers() }))).items).toEqual([])
  })

  let id = 0
  it('adds a folder (Unicode path), recording its volume and online state', async () => {
    const res = await fetch(base, { method: 'POST', headers: headers(), body: JSON.stringify({ path: media, libraryType: 'movies' }) })
    expect(res.status).toBe(201)
    const source = LibrarySource.parse(await res.json())
    id = source.id
    expect(source).toMatchObject({ path: media, libraryType: 'movies', recursive: true, enabled: true, availability: 'online' })
    expect(source.volumeId).toMatch(/^\d+$/)
  })

  it('rejects the same folder again, even with different case or a trailing slash', async () => {
    const res = await fetch(base, { method: 'POST', headers: headers(), body: JSON.stringify({ path: media.toLowerCase() + '\\' }) })
    const body = await json(res)
    expect(`${res.status} ${body.error.code}: ${body.error.message}`).toBe('409 source_exists: That folder has already been added')
  })

  it.each([
    ['a folder that does not exist', () => join(dir, 'nope'), 'not_found'],
    ['a file', () => join(dir, 'not-a-folder.txt'), 'not_a_directory'],
    ['a relative path', () => 'Movies', 'invalid_path'],
    ['a traversal path', () => `${dir}\\..\\x`, 'invalid_path'],
  ])('rejects %s with a clear error code', async (_label, path, code) => {
    const res = await fetch(base, { method: 'POST', headers: headers(), body: JSON.stringify({ path: path() }) })
    expect(res.status).toBe(400)
    expect((await json(res)).error.code).toBe(code)
  })

  it('updates type, recursion and enabled state', async () => {
    const res = await fetch(`${base}/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ libraryType: 'videos', recursive: false, enabled: false }),
    })
    expect(LibrarySource.parse(await res.json())).toMatchObject({ libraryType: 'videos', recursive: false, enabled: false })
    expect((await fetch(`${base}/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ libraryType: 'bogus' }) })).status).toBe(400)
    expect((await fetch(`${base}/9999`, { method: 'PATCH', headers: headers(), body: '{}' })).status).toBe(404)
  })

  it('reports a folder as offline when it disappears, and keeps the record', async () => {
    // Not rmSync({ recursive }): Node 24.0.2 silently leaves directories with non-ASCII names behind (see docs/11-risks.md).
    rmdirSync(media)
    const list = LibrarySourceList.parse(await json(await fetch(base, { headers: headers() })))
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({ id, availability: 'offline' })
    expect(list.items[0]!.lastSeenOnlineAt).not.toBeNull()
    mkdirSync(media)
  })

  it('comes back online when the folder returns', async () => {
    const list = LibrarySourceList.parse(await json(await fetch(base, { headers: headers() })))
    expect(list.items[0]!.availability).toBe('online')
  })

  it('removes a source without touching the folder on disk', async () => {
    writeFileSync(join(media, 'keep-me.mkv'), 'x')
    expect((await fetch(`${base}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${server.token}` } })).status).toBe(200)
    expect((await fetch(`${base}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${server.token}` } })).status).toBe(404)
    expect(existsSync(join(media, 'keep-me.mkv'))).toBe(true)
  })

  it('requires the API token', async () => {
    expect((await fetch(base)).status).toBe(401)
  })
})
