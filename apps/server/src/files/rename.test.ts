import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import type { MediaKind } from '@theama/contracts'
import { openDatabase, type DbHandle } from '../db/client'
import { LibrarySourceRepo } from '../library/sources'
import { titleKeyFor } from '../scan/filename'
import { MediaFileRepo } from '../scan/store'
import { TitleRepo } from '../scan/titles'
import { FileJournal } from './journal'
import { RenameService, type FsOps } from './rename'

const TEMPLATES = { movie: '{title} ({year})', episode: '{title} - {episodeCode} - {episodeTitle}' }

/** A pretend disk: a set of paths. Renames move entries; a rule can make a rename fail. */
class FakeDisk implements FsOps {
  readonly files = new Set<string>()
  failWhen: (from: string, to: string) => NodeJS.ErrnoException | null = () => null
  private readonly key = (p: string): string => p.toLowerCase()
  add(...paths: string[]): void {
    for (const p of paths) this.files.add(p)
  }
  has(path: string): boolean {
    return [...this.files].some((f) => this.key(f) === this.key(path))
  }
  async exists(path: string): Promise<boolean> {
    return this.has(path)
  }
  async rename(from: string, to: string): Promise<void> {
    const err = this.failWhen(from, to)
    if (err) throw err
    const actual = [...this.files].find((f) => this.key(f) === this.key(from))
    if (!actual) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    this.files.delete(actual)
    this.files.add(to)
  }
  async listDir(dir: string): Promise<string[]> {
    return [...this.files].filter((f) => f.slice(0, f.lastIndexOf('\\')).toLowerCase() === dir.toLowerCase()).map((f) => f.slice(f.lastIndexOf('\\') + 1))
  }
}

let handle: DbHandle
let disk: FakeDisk
let files: MediaFileRepo
let journal: FileJournal
let service: RenameService
let sourceId: number
const log = pino({ level: 'silent' })

function addFile(path: string, kind: MediaKind, title: string, year: number | null, extra: { season?: number; episode?: number; episodeEnd?: number } = {}): { id: number; key: string } {
  const key = titleKeyFor(kind, title, year, path)
  const [id] = files.insertMany([
    { sourceId, path, size: 1, mtimeMs: 1, state: 'available', firstSeenAt: 'x', lastSeenAt: 'x', kind, guessedTitle: title, guessedYear: year, season: extra.season ?? null, episode: extra.episode ?? null, episodeEnd: extra.episodeEnd ?? null, episodeTitle: null, titleKey: key },
  ])
  disk.add(path)
  return { id: id!, key }
}

beforeEach(() => {
  handle = openDatabase(':memory:')
  disk = new FakeDisk()
  files = new MediaFileRepo(handle.db, handle.raw)
  sourceId = new LibrarySourceRepo(handle.db).create({ path: 'D:\\M', libraryType: 'auto', recursive: true, volumeId: '1' }).id
  journal = new FileJournal(handle.raw)
  service = new RenameService({ raw: handle.raw, titles: new TitleRepo(handle.raw), files, journal, fs: disk, logger: log })
})
afterEach(() => handle.close())

const approveOk = (items: { status: string; from: string; to: string }[]) => items.filter((i) => i.status === 'ok').map((i) => ({ from: i.from, to: i.to }))

describe('which subtitles travel with a video', () => {
  it('reads a shared directory once per preview and refreshes it for the next preview', async () => {
    const a = addFile('D:\\M\\Alpha.2001.mkv', 'movie', 'Alpha', 2001)
    const b = addFile('D:\\M\\Beta.2002.mkv', 'movie', 'Beta', 2002)
    const listing = vi.spyOn(disk, 'listDir')
    await service.preview({ keys: [a.key, b.key] }, TEMPLATES)
    expect(listing).toHaveBeenCalledOnce()
    disk.add('D:\\M\\Alpha.2001.srt')
    const next = await service.preview({ keys: [a.key] }, TEMPLATES)
    expect(listing).toHaveBeenCalledTimes(2)
    expect(next.items.some(item => item.kind === 'subtitle')).toBe(true)
  })
  it('leaves the subtitles of a longer-named neighbour with that neighbour', async () => {
    const dune = addFile('D:\\M\\Dune.2021.mkv', 'movie', 'Dune', 2021)
    addFile('D:\\M\\Dune Part Two.2024.mkv', 'movie', 'Dune Part Two', 2024)
    disk.add('D:\\M\\Dune.2021.en.srt', 'D:\\M\\Dune Part Two.2024.en.srt')
    const p = await service.preview({ keys: [dune.key] }, TEMPLATES)
    expect(p.items.map((i) => [i.fromName, i.toName])).toEqual([
      ['Dune.2021.mkv', 'Dune (2021).mkv'],
      ['Dune.2021.en.srt', 'Dune (2021).en.srt'],
    ])
  })

  it('does not take along a subtitle when the video itself cannot be renamed', async () => {
    const a = addFile('D:\\M\\Film.2020.mkv', 'movie', 'Film', 2020)
    disk.add('D:\\M\\Film.2020.srt', 'D:\\M\\Film (2020).mkv')
    const p = await service.preview({ keys: [a.key] }, TEMPLATES)
    expect(p.items.map((i) => i.status)).toEqual(['collision_exists'])
  })
})

describe('what the template gets', () => {
  it('numbers multi-episode files and leaves out what is not known', async () => {
    const e = addFile('D:\\M\\dark.s01e03e04.mkv', 'episode', 'Dark', null, { season: 1, episode: 3, episodeEnd: 4 })
    const p = await service.preview({ keys: [e.key] }, TEMPLATES)
    expect(p.items[0]?.toName).toBe('Dark - S01E03-E04.mkv') // no episode title known: the dangling " - " is dropped
  })

  it('skips an episode that has no number, and a film template needs no year', async () => {
    const e = addFile('D:\\M\\Dark.something.mkv', 'episode', 'Dark', null)
    expect((await service.preview({ keys: [e.key] }, TEMPLATES)).items[0]?.status).toBe('skipped')
    const m = addFile('D:\\M\\Untitled.Home.Movie.mkv', 'movie', 'Untitled Home Movie', null)
    expect((await service.preview({ keys: [m.key] }, TEMPLATES)).items[0]?.toName).toBe('Untitled Home Movie.mkv')
  })

  it('renames a name that differs only in capitals, which Windows treats as the same file', async () => {
    const f = addFile('D:\\M\\film (2020).mkv', 'movie', 'Film', 2020)
    const p = await service.preview({ keys: [f.key] }, TEMPLATES)
    expect(p.items[0]).toMatchObject({ toName: 'Film (2020).mkv', status: 'ok' })
    const r = await service.apply({ keys: [f.key], approved: approveOk(p.items) }, TEMPLATES)
    expect(r.batch?.done).toBe(1)
    expect(disk.files.has('D:\\M\\Film (2020).mkv')).toBe(true)
  })

  it('does not rename a file whose drive is offline', async () => {
    const f = addFile('D:\\M\\Film.2020.mkv', 'movie', 'Film', 2020)
    handle.raw.prepare("UPDATE library_source SET availability = 'offline'").run()
    expect((await service.preview({ keys: [f.key] }, TEMPLATES)).items[0]?.status).toBe('unavailable')
  })

  it('refuses a path that would be too long', async () => {
    const f = addFile(`D:\\${'x'.repeat(100)}\\${'y'.repeat(60)}\\Film.2020.mkv`, 'movie', 'A '.repeat(80).trim(), 2020)
    expect((await service.preview({ keys: [f.key] }, TEMPLATES)).items[0]?.status).toBe('too_long')
  })
})

describe('when a rename fails', () => {
  it('records the failure, carries on with the rest, and does not rename the subtitle of a video that stayed', async () => {
    const a = addFile('D:\\M\\Alpha.2001.mkv', 'movie', 'Alpha', 2001)
    const b = addFile('D:\\M\\Beta.2002.mkv', 'movie', 'Beta', 2002)
    disk.add('D:\\M\\Alpha.2001.srt', 'D:\\M\\Beta.2002.srt')
    disk.failWhen = (from) => (from.endsWith('Alpha.2001.mkv') ? Object.assign(new Error('EBUSY'), { code: 'EBUSY' }) : null)
    const keys = [a.key, b.key]
    const p = await service.preview({ keys }, TEMPLATES)
    const r = await service.apply({ keys, approved: approveOk(p.items) }, TEMPLATES)
    expect(r.batch).toMatchObject({ total: 4, done: 2, failed: 2 })
    expect(r.batch?.items.filter((i) => i.status === 'failed').map((i) => i.error)).toEqual(['The file is in use by another program', 'Skipped because its video could not be renamed'])
    expect(disk.has('D:\\M\\Alpha.2001.mkv')).toBe(true)
    expect(disk.has('D:\\M\\Alpha.2001.srt')).toBe(true)
    expect(disk.has('D:\\M\\Beta (2002).mkv') && disk.has('D:\\M\\Beta (2002).srt')).toBe(true)
    // The library names only what really moved.
    const paths = (handle.raw.prepare('SELECT path FROM media_file ORDER BY id').all() as { path: string }[]).map((r) => r.path)
    expect(paths).toEqual(['D:\\M\\Alpha.2001.mkv', 'D:\\M\\Beta (2002).mkv'])
  })

  it('does not overwrite a file that appeared between the preview and the apply', async () => {
    const a = addFile('D:\\M\\Alpha.2001.mkv', 'movie', 'Alpha', 2001)
    const p = await service.preview({ keys: [a.key] }, TEMPLATES)
    disk.add('D:\\M\\Alpha (2001).mkv') // somebody got there first
    const r = await service.apply({ keys: [a.key], approved: approveOk(p.items) }, TEMPLATES)
    expect(r).toEqual({ batch: null, changed: 1 })
    expect(disk.has('D:\\M\\Alpha.2001.mkv')).toBe(true)
  })
})

describe('recovering after a crash', () => {
  it('settles each unfinished rename by looking at the disk, and makes the library agree', async () => {
    const happened = addFile('D:\\M\\One.2001.mkv', 'movie', 'One', 2001)
    const notYet = addFile('D:\\M\\Two.2002.mkv', 'movie', 'Two', 2002)
    const lost = addFile('D:\\M\\Three.2003.mkv', 'movie', 'Three', 2003)
    const { rows } = journal.begin(
      [
        { kind: 'video', fileId: happened.id, from: 'D:\\M\\One.2001.mkv', to: 'D:\\M\\One (2001).mkv' },
        { kind: 'video', fileId: notYet.id, from: 'D:\\M\\Two.2002.mkv', to: 'D:\\M\\Two (2002).mkv' },
        { kind: 'video', fileId: lost.id, from: 'D:\\M\\Three.2003.mkv', to: 'D:\\M\\Three (2003).mkv' },
      ],
      '2025-01-01T00:00:00.000Z',
    )
    // The crash: the first rename reached the disk (not the library or journal); the second never started; the third file vanished.
    disk.files.delete('D:\\M\\One.2001.mkv')
    disk.add('D:\\M\\One (2001).mkv')
    disk.files.delete('D:\\M\\Three.2003.mkv')
    expect(journal.interruptedBatches()).toHaveLength(1)

    expect(await service.recover()).toBe(3)

    const after = journal.rows(rows[0]!.batchId)
    expect(after.map((r) => r.status)).toEqual(['done', 'failed', 'failed'])
    expect(after[1]?.error).toMatch(/before the rename happened/)
    expect(after[2]?.error).toMatch(/neither name exists/)
    const path = (id: number) => (handle.raw.prepare('SELECT path FROM media_file WHERE id = ?').get(id) as { path: string }).path
    expect(path(happened.id)).toBe('D:\\M\\One (2001).mkv')
    expect(path(notYet.id)).toBe('D:\\M\\Two.2002.mkv')
    expect(journal.interruptedBatches()).toEqual([])
    expect(await service.recover()).toBe(0)
  })
})

describe('the journal', () => {
  it('lists newest batches first with their counts', async () => {
    const a = addFile('D:\\M\\Alpha.2001.mkv', 'movie', 'Alpha', 2001)
    const b = addFile('D:\\M\\Beta.2002.mkv', 'movie', 'Beta', 2002)
    for (const k of [a.key, b.key]) {
      const p = await service.preview({ keys: [k] }, TEMPLATES)
      await service.apply({ keys: [k], approved: approveOk(p.items) }, TEMPLATES)
    }
    const list = journal.list(10)
    expect(list).toHaveLength(2)
    expect(list[0]?.items[0]?.to).toContain('Beta')
    expect(list.every((b) => b.canRollback && b.done === 1)).toBe(true)
  })
})
