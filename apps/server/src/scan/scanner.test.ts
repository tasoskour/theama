import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { copyFile, rename, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryType } from '@theama/contracts'
import { openDatabase, type DbHandle } from '../db/client'
import { LibrarySourceRepo } from '../library/sources'
import { ProbeError, type ProbeFn, type ProbeResult } from './probe'
import { runScan, type ScanContext } from './scanner'
import { MediaFileRepo } from './store'

const PROBED: ProbeResult = { durationMs: 60_000, width: 1920, height: 1080, container: 'matroska', videoCodec: 'hevc', audioCodecs: ['aac'], subtitleCount: 1 }

let root: string
let handle: DbHandle
let library: LibrarySourceRepo
let files: MediaFileRepo

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theama-scan-'))
  handle = openDatabase(':memory:')
  library = new LibrarySourceRepo(handle.db)
  files = new MediaFileRepo(handle.db, handle.raw)
})
afterEach(async () => {
  handle.close()
  await rm(root, { recursive: true, force: true })
})

function addSource(path: string, libraryType: LibraryType = 'auto', recursive = true) {
  return library.create({ path, libraryType, recursive, volumeId: '1' })
}

function put(path: string, content = 'x', mtime?: Date): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  if (mtime) utimesSync(path, mtime, mtime)
  return path
}

function scan(sourceId: number, over: Partial<ScanContext> = {}) {
  return runScan({
    source: library.get(sourceId)!,
    nestedRoots: [],
    files,
    probe: async () => PROBED,
    probeConcurrency: 2,
    isCancelled: () => false,
    checkOnline: async () => true,
    progress: () => undefined,
    ...over,
  })
}

const rows = (sourceId: number) => files.forSource(sourceId)

describe('first scan', () => {
  it('finds videos recursively, ignores everything else, parses names and probes each file', async () => {
    put(join(root, 'Ταινίες', 'Interstellar.2014.2160p.BluRay.x265.mkv'))
    put(join(root, 'Show', 'Season 1', 'Show.S01E02.Pilot.1080p.mkv'))
    put(join(root, 'Show', 'Season 1', 'Show.S01E02.Pilot.srt'))
    put(join(root, 'notes.txt'))
    put(join(root, '.abc123.parts'))
    const source = addSource(root)
    const probe = vi.fn<ProbeFn>(async () => PROBED)

    const out = await scan(source.id, { probe })

    expect(out.status).toBe('done')
    expect(out.summary).toMatchObject({ found: 2, new: 2, changed: 0, moved: 0, missing: 0, probed: 2, errors: 0 })
    expect(probe).toHaveBeenCalledTimes(2)
    const byTitle = Object.fromEntries(rows(source.id).map((r) => [r.guessedTitle, r]))
    expect(byTitle['Interstellar']).toMatchObject({ kind: 'movie', guessedYear: 2014, durationMs: 60_000, height: 1080, videoCodec: 'hevc', audioCodecs: 'aac' })
    expect(byTitle['Show']).toMatchObject({ kind: 'episode', season: 1, episode: 2, episodeTitle: 'Pilot' })
  })

  it('does not descend into subfolders when the source is not recursive', async () => {
    put(join(root, 'a.mkv'))
    put(join(root, 'sub', 'b.mkv'))
    const out = await scan(addSource(root, 'auto', false).id)
    expect(out.summary.found).toBe(1)
  })

  it('without FFprobe the files are still listed, with an explanation', async () => {
    put(join(root, 'a.2020.mkv'))
    const source = addSource(root)
    const out = await scan(source.id, { probe: null })
    expect(out.status).toBe('done')
    expect(out.diagnostics.join(' ')).toMatch(/FFprobe was not found/)
    expect(rows(source.id)[0]).toMatchObject({ probedAt: null, durationMs: null })
  })

  it('records a probe failure on the file and keeps scanning; the failure is not retried while the file is unchanged', async () => {
    put(join(root, 'good.mkv'))
    put(join(root, 'junk.mkv'))
    const source = addSource(root)
    const probe = vi.fn<ProbeFn>(async (p) => {
      if (p.endsWith('junk.mkv')) throw new ProbeError('Invalid data found when processing input')
      return PROBED
    })
    const first = await scan(source.id, { probe })
    expect(first.status).toBe('done')
    expect(first.summary).toMatchObject({ probed: 1, errors: 1 })
    expect(rows(source.id).find((r) => r.path.endsWith('junk.mkv'))).toMatchObject({ probeError: 'Invalid data found when processing input' })

    probe.mockClear()
    await scan(source.id, { probe })
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('rescans', () => {
  it('skips unchanged files without probing them again', async () => {
    put(join(root, 'a.2020.mkv'))
    put(join(root, 'b.2021.mkv'))
    const source = addSource(root)
    await scan(source.id)
    const probe = vi.fn<ProbeFn>(async () => PROBED)
    const out = await scan(source.id, { probe })
    expect(out.summary).toMatchObject({ found: 2, skipped: 2, new: 0, changed: 0 })
    expect(probe).not.toHaveBeenCalled()
  })

  it('picks up new files and re-probes a changed file', async () => {
    const a = put(join(root, 'a.2020.mkv'), 'x', new Date('2024-01-01'))
    const source = addSource(root)
    await scan(source.id)
    put(a, 'longer content', new Date('2025-01-01'))
    put(join(root, 'c.2022.mkv'))
    const probe = vi.fn<ProbeFn>(async () => PROBED)
    const out = await scan(source.id, { probe })
    expect(out.summary).toMatchObject({ new: 1, changed: 1, skipped: 0 })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('recognises a renamed file by its NTFS id and keeps the same row (and its probe data)', async () => {
    const original = put(join(root, 'Movie.Name.2020.1080p.mkv'))
    const source = addSource(root)
    await scan(source.id)
    const before = rows(source.id)[0]!

    await rename(original, join(root, 'Renamed Folder Ταινία (2020).mkv'))
    const probe = vi.fn<ProbeFn>(async () => PROBED)
    const out = await scan(source.id, { probe })

    expect(out.summary).toMatchObject({ moved: 1, new: 0, missing: 0 })
    const after = rows(source.id)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before.id, guessedTitle: 'Renamed Folder Ταινία', guessedYear: 2020, durationMs: 60_000 })
    expect(probe).not.toHaveBeenCalled()
  })

  it('recognises a file moved to another folder of the same source', async () => {
    const original = put(join(root, 'a', 'Film.2019.mkv'))
    const source = addSource(root)
    await scan(source.id)
    mkdirSync(join(root, 'b'))
    await rename(original, join(root, 'b', 'Film.2019.mkv'))
    const out = await scan(source.id)
    expect(out.summary).toMatchObject({ moved: 1, new: 0 })
    expect(rows(source.id)).toHaveLength(1)
  })

  it('recognises a renamed copy (new NTFS id) by its size and modified time', async () => {
    const mtime = new Date('2024-05-01T10:00:00Z')
    const original = put(join(root, 'stalker .mkv'), 'film', mtime)
    const source = addSource(root)
    await scan(source.id)
    const before = rows(source.id)[0]!

    const renamed = join(root, "Andrei Tarkovsky's Stalker (1979).mkv")
    await copyFile(original, renamed)
    utimesSync(renamed, mtime, mtime)
    await unlink(original)
    const out = await scan(source.id)

    expect(out.summary).toMatchObject({ moved: 1, new: 0, missing: 0 })
    expect(rows(source.id)).toHaveLength(1)
    expect(rows(source.id)[0]).toMatchObject({ id: before.id, path: renamed, state: 'available', guessedYear: 1979 })
  })

  it('does not guess when several vanished files and new files look alike', async () => {
    const mtime = new Date('2024-05-01T10:00:00Z')
    const a = put(join(root, 'a.2020.mkv'), 'same', mtime)
    const b = put(join(root, 'b.2021.mkv'), 'same', mtime)
    const source = addSource(root)
    await scan(source.id)
    for (const [from, to] of [[a, 'c.2022.mkv'], [b, 'd.2023.mkv']] as const) {
      await copyFile(from, join(root, to))
      utimesSync(join(root, to), mtime, mtime)
      await unlink(from)
    }
    const out = await scan(source.id)
    expect(out.summary).toMatchObject({ moved: 0, new: 2, missing: 2 })
  })

  it('keeps a hidden file hidden under its new name, and its exclusion follows it', async () => {
    const original = put(join(root, 'Hidden.Film.2020.mkv'))
    const source = addSource(root)
    await scan(source.id)
    const row = rows(source.id)[0]!
    handle.raw.prepare('UPDATE media_file SET excluded = 1 WHERE id = ?').run(row.id)
    handle.raw.prepare("INSERT INTO library_exclusion (source_id, path, kind, created_at) VALUES (?, ?, 'file', 'now')").run(source.id, original)

    const renamed = join(root, 'Hidden Film (2020).mkv')
    await rename(original, renamed)
    const exclusions = [{ id: 1, sourceId: source.id, path: original, kind: 'file' as const, createdAt: 'now' }]
    const out = await scan(source.id, { exclusions })

    expect(out.summary).toMatchObject({ moved: 1, new: 0, missing: 0 })
    expect(rows(source.id)[0]).toMatchObject({ id: row.id, path: renamed, excluded: true })
    expect(handle.raw.prepare('SELECT path FROM library_exclusion').all()).toEqual([{ path: renamed }])
  })

  it('re-interprets the names when the folder type changes', async () => {
    put(join(root, 'Holiday.2019.1080p.mkv'))
    const source = addSource(root, 'auto')
    await scan(source.id)
    expect(rows(source.id)[0]!.kind).toBe('movie')
    handle.raw.prepare("UPDATE library_source SET library_type = 'videos' WHERE id = ?").run(source.id)
    await scan(source.id)
    expect(rows(source.id)[0]).toMatchObject({ kind: 'video', guessedTitle: 'Holiday.2019.1080p' })
  })
})

describe('missing files and offline folders (nothing is ever deleted)', () => {
  it('flags a deleted file as missing, keeps its row, and restores it if it comes back', async () => {
    const a = put(join(root, 'a.2020.mkv'))
    put(join(root, 'b.2021.mkv'))
    const source = addSource(root)
    await scan(source.id)

    await unlink(a)
    const out = await scan(source.id)
    expect(out.summary).toMatchObject({ missing: 1, found: 1 })
    const gone = rows(source.id).find((r) => r.path === a)!
    expect(gone).toMatchObject({ state: 'missing_unconfirmed' })
    expect(gone.missingSince).not.toBeNull()
    expect(gone.durationMs).toBe(60_000) // its metadata is intact

    // not counted as missing again on the next scan
    expect((await scan(source.id)).summary.missing).toBe(0)

    put(a)
    const back = await scan(source.id)
    expect(back.summary.changed).toBeGreaterThanOrEqual(1)
    expect(rows(source.id).find((r) => r.path === a)).toMatchObject({ state: 'available', missingSince: null })
  })

  it('an unreachable folder fails the scan and changes nothing', async () => {
    put(join(root, 'a.2020.mkv'))
    const source = addSource(root)
    await scan(source.id)
    const before = JSON.stringify(rows(source.id))
    const out = await scan(source.id, { checkOnline: async () => false })
    expect(out.status).toBe('failed')
    expect(out.diagnostics.join(' ')).toMatch(/cannot be reached/)
    expect(JSON.stringify(rows(source.id))).toBe(before)
  })

  it('a folder that goes offline during the scan does not get its files marked missing', async () => {
    const a = put(join(root, 'a.2020.mkv'))
    const source = addSource(root)
    await scan(source.id)
    await unlink(a) // looks like a deletion, but the drive is unplugged by the time we decide
    let calls = 0
    const out = await scan(source.id, { checkOnline: async () => ++calls === 1 })
    expect(out.summary.missing).toBe(0)
    expect(out.diagnostics.join(' ')).toMatch(/went offline/)
    expect(rows(source.id)[0]!.state).toBe('available')
  })

  it('a cancelled scan changes nothing about existing files', async () => {
    const a = put(join(root, 'a.2020.mkv'))
    put(join(root, 'sub', 'b.2021.mkv'))
    const source = addSource(root)
    await scan(source.id)
    await unlink(a)
    const out = await scan(source.id, { isCancelled: () => true })
    expect(out.status).toBe('cancelled')
    expect(rows(source.id).every((r) => r.state === 'available')).toBe(true)
  })
})

describe('tree safety', () => {
  it('does not follow a junction that loops back into the tree', async () => {
    put(join(root, 'a.2020.mkv'))
    mkdirSync(join(root, 'sub'))
    put(join(root, 'sub', 'b.2021.mkv'))
    symlinkSync(root, join(root, 'sub', 'loop'), 'junction')
    const out = await scan(addSource(root).id)
    expect(out.status).toBe('done')
    expect(out.summary.found).toBe(2)
  })

  it('leaves a nested library folder to its own source (no duplicate indexing)', async () => {
    put(join(root, 'parent.2020.mkv'))
    put(join(root, 'Marvel', 'child.2021.mkv'))
    const parent = addSource(root)
    const child = addSource(join(root, 'Marvel'))
    const outParent = await scan(parent.id, { nestedRoots: [child.path] })
    const outChild = await scan(child.id)
    expect(outParent.summary.found).toBe(1)
    expect(outChild.summary.found).toBe(1)
    expect(rows(parent.id).map((r) => r.guessedTitle)).toEqual(['parent'])
  })

  it('classifies featurettes as extras', async () => {
    put(join(root, 'Show S01', 'Show.S01E01.mkv'))
    put(join(root, 'Show S01', 'Featurettes', 'Making of.mkv'))
    const source = addSource(root, 'series')
    await scan(source.id)
    expect(rows(source.id).map((r) => r.kind).sort()).toEqual(['episode', 'extra'])
  })
})

describe('progress', () => {
  it('reports the phases in order', async () => {
    put(join(root, 'a.2020.mkv'))
    const phases: string[] = []
    await scan(addSource(root).id, { progress: (p) => phases.push(p.phase) })
    expect(phases[0]).toBe('walking')
    expect(phases).toContain('finalizing')
    expect(phases.at(-1)).toBe('probing')
  })
})
