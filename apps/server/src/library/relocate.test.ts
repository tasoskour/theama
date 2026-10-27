import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db/client'
import { MediaFileRepo, type NewFileRow } from '../scan/store'
import { titleKeyFor } from '../scan/filename'
import { assertRelocatable, findRelocation } from './relocate'
import { ApiProblem, LibrarySourceRepo } from './sources'

const onDrives = (serials: Record<string, string>) => async (p: string) => {
  const serial = serials[p[0]!.toUpperCase()]
  if (!serial) throw new Error('ENOENT')
  return { volumeId: serial }
}

describe('findRelocation', () => {
  const source = { path: 'E:\\Films', volumeId: '123' }

  it('finds the same folder on the drive that carries the recorded serial', async () => {
    expect(await findRelocation(source, [], onDrives({ G: '123', C: '1' }))).toEqual({ kind: 'found', path: 'G:\\Films', volumeId: '123' })
  })
  it('ignores another disk that holds the same folder', async () => {
    expect(await findRelocation(source, [], onDrives({ G: '999' }))).toEqual({ kind: 'none' })
  })
  it('does not guess when two drives share the serial', async () => {
    const r = await findRelocation(source, [], onDrives({ F: '123', G: '123' }))
    expect(r).toEqual({ kind: 'ambiguous', paths: ['F:\\Films', 'G:\\Films'] })
  })
  it('skips folders another source already uses', async () => {
    expect(await findRelocation(source, ['g:\\films'], onDrives({ G: '123' }))).toEqual({ kind: 'none' })
  })
  it('cannot match network paths or folders without a recorded serial', async () => {
    expect(await findRelocation({ path: '\\\\NAS\\films', volumeId: '123' }, [], onDrives({ G: '123' }))).toEqual({ kind: 'none' })
    expect(await findRelocation({ path: 'E:\\Films', volumeId: null }, [], onDrives({ G: '123' }))).toEqual({ kind: 'none' })
  })
})

describe('assertRelocatable', () => {
  const a = { id: 1, path: 'E:\\Films' }
  const b = { id: 2, path: 'F:\\Series' }
  it('accepts a new drive letter', () => expect(() => assertRelocatable(a, 'G:\\Films', [a, b])).not.toThrow())
  it('rejects a folder another source uses, the same folder, and overlapping folders', () => {
    expect(() => assertRelocatable(a, 'f:\\series', [a, b])).toThrow(ApiProblem)
    expect(() => assertRelocatable(a, 'E:\\films\\', [a, b])).toThrow(ApiProblem)
    expect(() => assertRelocatable(a, 'E:\\Films\\Old', [a, b])).toThrow(ApiProblem)
    expect(() => assertRelocatable(a, 'E:\\', [a, b])).toThrow(ApiProblem)
  })
})

describe('MediaFileRepo.relocateSource', () => {
  it('moves paths, exclusions and path-derived title keys, and keeps path-independent ones', () => {
    const handle = openDatabase(':memory:')
    const sources = new LibrarySourceRepo(handle.db)
    const files = new MediaFileRepo(handle.db, handle.raw)
    const id = sources.create({ path: 'E:\\Media', libraryType: 'auto', recursive: true, volumeId: '1' }).id
    const row = (path: string, kind: NewFileRow['kind'], title: string): NewFileRow => ({
      sourceId: id, path, size: 1, mtimeMs: 1, state: 'available', firstSeenAt: 'x', lastSeenAt: 'x', kind, guessedTitle: title,
      guessedYear: null, season: null, episode: null, episodeEnd: null, episodeTitle: null, titleKey: titleKeyFor(kind, title, null, path),
    })
    files.insertMany([row('E:\\Media\\Holiday.mp4', 'video', 'Holiday'), row('E:\\Media\\Heat (1995).mkv', 'movie', 'Heat')])
    const oldKey = titleKeyFor('video', 'Holiday', null, 'E:\\Media\\Holiday.mp4')
    handle.raw.prepare('INSERT INTO title_match (title_key, kind, state, decided_by, locked, attempts, attempted_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)').run(oldKey, 'movie', 'unmatched', 'auto', 'x', 'x')
    handle.raw.prepare("INSERT INTO library_exclusion (source_id, path, kind, created_at) VALUES (?, 'E:\\Media\\Junk', 'folder', 'x')").run(id)

    files.relocateSource(id, 'G:\\Media', '2')

    expect(sources.get(id)).toMatchObject({ path: 'G:\\Media', volumeId: '2' })
    const rows = handle.raw.prepare('SELECT path, title_key FROM media_file ORDER BY id').all() as { path: string; title_key: string }[]
    expect(rows.map((r) => r.path)).toEqual(['G:\\Media\\Holiday.mp4', 'G:\\Media\\Heat (1995).mkv'])
    expect(rows[0]!.title_key).toBe('video:g:\\media\\holiday.mp4')
    expect(rows[1]!.title_key).toBe(titleKeyFor('movie', 'Heat', null, ''))
    expect((handle.raw.prepare('SELECT title_key FROM title_match').get() as { title_key: string }).title_key).toBe('video:g:\\media\\holiday.mp4')
    expect((handle.raw.prepare('SELECT path FROM library_exclusion').get() as { path: string }).path).toBe('G:\\Media\\Junk')
    const indexed = (q: string) => handle.raw.prepare('SELECT rowid FROM media_file_fts WHERE media_file_fts MATCH ?').all(q).length
    expect(indexed('path_text:g')).toBe(2)
    expect(indexed('path_text:e')).toBe(0)
    handle.close()
  })
})
