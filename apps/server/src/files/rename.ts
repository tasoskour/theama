import { lstat, readdir, rename as fsRename } from 'node:fs/promises'
import { win32 } from 'node:path'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import type {
  MediaFile,
  OperationBatch,
  RenameApplyRequest,
  RenameApplyResult,
  RenameItem,
  RenamePreview,
  RenamePreviewRequest,
  RenameStatus,
  TitleDetail,
} from '@theama/contracts'
import { withTimeout } from '../library/sources'
import type { MediaFileRepo } from '../scan/store'
import type { TitleRepo } from '../scan/titles'
import { SUBTITLE_EXTENSIONS } from '../subtitles/discover'
import { FileJournal, type JournalRow } from './journal'
import { cleanFileName, renderTemplate, validateTemplate, TemplateError, type TemplateValues } from './template'

export class RenameProblem extends Error {
  constructor(
    readonly code: 'not_found' | 'not_renamable' | 'invalid_template',
    message: string,
  ) {
    super(message)
  }
}

/** The file system, as the rename logic needs it; tests can replace it. */
export interface FsOps {
  exists(path: string): Promise<boolean>
  rename(from: string, to: string): Promise<void>
  listDir(dir: string): Promise<string[]>
}

export const realFs: FsOps = {
  exists: async (path) => {
    try {
      await withTimeout(lstat(path))
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') return false
      throw err
    }
  },
  rename: (from, to) => fsRename(from, to),
  listDir: (dir) => withTimeout(readdir(dir)),
}

/** Windows' classic limit is 260 characters for a whole path; stay clear of it. */
const MAX_PATH = 240
const VIDEO_EXTENSIONS = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm'])

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const pad2 = (n: number): string => String(n).padStart(2, '0')

function resolution(height: number | null): string | null {
  if (!height) return null
  return height >= 2000 ? '2160p' : height >= 1000 ? '1080p' : height >= 700 ? '720p' : height >= 500 ? '576p' : `${height}p`
}

interface PlanEntry extends RenameItem {
  /** Index of the video this subtitle travels with. */
  parent: number | null
}

export interface RenameDeps {
  raw: Database.Database
  titles: TitleRepo
  files: MediaFileRepo
  journal: FileJournal
  fs?: FsOps
  logger: Logger
  now?: () => Date
}

/**
 * Renames files by template — a preview first, then only what the person approved, each rename written to a
 * journal before it happens so it can be undone (or understood after a crash). Files are renamed in place
 * (same folder): nothing is moved, deleted or overwritten, and a name that is already taken is a collision,
 * never an overwrite. A subtitle that sits next to a video and shares its name travels with it.
 */
export class RenameService {
  private readonly fs: FsOps
  private busy: Promise<unknown> = Promise.resolve()

  constructor(private readonly d: RenameDeps) {
    this.fs = d.fs ?? realFs
  }

  private now(): string {
    return (this.d.now?.() ?? new Date()).toISOString()
  }

  /** One rename job at a time, so two batches cannot fight over the same names. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.busy.then(work, work)
    this.busy = run.catch(() => undefined)
    return run
  }

  private values(detail: TitleDetail, f: MediaFile): TemplateValues | null {
    const s = detail.summary
    const base = { resolution: resolution(f.height), videoCodec: f.videoCodec ? f.videoCodec.toUpperCase() : null }
    if (f.kind === 'movie') return { title: s.title, year: s.year, season: null, episode: null, episodeCode: null, episodeTitle: null, ...base }
    if (f.season === null || f.episode === null) return null
    const info = detail.episodes.find((e) => e.season === f.season && e.episode === f.episode)
    const range = f.episodeEnd !== null && f.episodeEnd > f.episode ? `-E${pad2(f.episodeEnd)}` : ''
    return {
      title: s.title,
      year: s.year,
      season: f.season,
      episode: f.episode,
      episodeCode: `S${pad2(f.season)}E${pad2(f.episode)}${range}`,
      episodeTitle: info?.name ?? f.episodeTitle,
      ...base,
    }
  }

  private async statusOf(from: string, to: string): Promise<RenameStatus> {
    if (to === from) return 'unchanged'
    if (to.length > MAX_PATH) return 'too_long'
    if (!sameName(from, to) && (await this.fs.exists(to))) return 'collision_exists'
    return 'ok'
  }

  /** What would happen. Nothing is touched. */
  async preview(req: RenamePreviewRequest, templates: { movie: string; episode: string }): Promise<RenamePreview> {
    const movieTemplate = req.movieTemplate ?? templates.movie
    const episodeTemplate = req.episodeTemplate ?? templates.episode
    try {
      validateTemplate(movieTemplate)
      validateTemplate(episodeTemplate)
    } catch (err) {
      if (err instanceof TemplateError) throw new RenameProblem('invalid_template', err.message)
      throw err
    }
    const entries = await this.plan(req.keys, movieTemplate, episodeTemplate)
    const counts: Record<string, number> = {}
    for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1
    return { items: entries.map(({ parent: _parent, ...item }) => item), counts }
  }

  private async plan(keys: readonly string[], movieTemplate: string, episodeTemplate: string): Promise<PlanEntry[]> {
    const entries: PlanEntry[] = []
    const directories = new Map<string, Promise<string[]>>()
    for (const key of keys) {
      const detail = this.d.titles.detail(key)
      if (!detail) throw new RenameProblem('not_found', 'No such title')
      if (detail.summary.kind === 'video') throw new RenameProblem('not_renamable', 'Personal videos are never renamed by templates')
      for (const f of detail.files) {
        if (f.kind !== 'movie' && f.kind !== 'episode') continue
        const dir = win32.dirname(f.path)
        const make = (over: Partial<PlanEntry> & Pick<PlanEntry, 'to' | 'status'>): PlanEntry => ({
          fileId: f.id, kind: 'video', titleKey: key, from: f.path, fromName: win32.basename(f.path), toName: win32.basename(over.to), parent: null, ...over,
        })
        if (f.state === 'source_offline') { entries.push(make({ to: f.path, status: 'unavailable' })); continue }
        if (f.state === 'missing_unconfirmed') { entries.push(make({ to: f.path, status: 'missing' })); continue }
        const values = this.values(detail, f)
        const base = values ? cleanFileName(renderTemplate(f.kind === 'movie' ? movieTemplate : episodeTemplate, values)) : ''
        if (!base) { entries.push(make({ to: f.path, status: 'skipped' })); continue }
        const ext = win32.extname(f.path)
        const to = win32.join(dir, base + ext)
        const status = await this.statusOf(f.path, to)
        const videoIndex = entries.push(make({ to, status })) - 1
        if (status === 'ok') entries.push(...(await this.companions(f, dir, base, key, videoIndex, directories)))
      }
    }
    // Two files that want the same name: neither gets it.
    const wanted = new Map<string, number[]>()
    entries.forEach((e, i) => {
      if (e.status !== 'ok') return
      const k = e.to.toLowerCase()
      wanted.set(k, [...(wanted.get(k) ?? []), i])
    })
    for (const group of wanted.values()) if (group.length > 1) for (const i of group) entries[i]!.status = 'collision_batch'
    // A subtitle follows its video: if the video is not going to move, neither is the subtitle.
    for (const e of entries) if (e.parent !== null && e.status === 'ok' && entries[e.parent]!.status !== 'ok') e.status = entries[e.parent]!.status
    return entries
  }

  /** Subtitle files beside the video whose names start with the video's name. */
  private async companions(f: MediaFile, dir: string, newBase: string, key: string, parent: number, directories: Map<string, Promise<string[]>>): Promise<PlanEntry[]> {
    let names: string[]
    try {
      const directoryKey = dir.toLowerCase()
      let listing = directories.get(directoryKey)
      if (!listing) { listing = this.fs.listDir(dir); directories.set(directoryKey, listing) }
      names = await listing
    } catch {
      return []
    }
    const ext = win32.extname(f.path)
    const oldBase = win32.basename(f.path, ext)
    // Other videos here with a longer name that also starts with ours ("Film Extra" next to "Film") own their own subtitles.
    const siblings = names
      .filter((n) => VIDEO_EXTENSIONS.has(win32.extname(n).slice(1).toLowerCase()) && !sameName(n, win32.basename(f.path)))
      .map((n) => win32.basename(n, win32.extname(n)).toLowerCase())
      .filter((b) => b.length > oldBase.length && b.startsWith(oldBase.toLowerCase()))
    const out: PlanEntry[] = []
    for (const name of names) {
      const subExt = win32.extname(name).slice(1).toLowerCase()
      if (!(SUBTITLE_EXTENSIONS as readonly string[]).includes(subExt)) continue
      const stem = win32.basename(name, win32.extname(name))
      const lower = stem.toLowerCase()
      const startsWithBase = lower === oldBase.toLowerCase() || (lower.startsWith(oldBase.toLowerCase()) && /[.\s_\-[(]/.test(stem.charAt(oldBase.length)))
      if (!startsWithBase || siblings.some((b) => lower.startsWith(b))) continue
      const from = win32.join(dir, name)
      const to = win32.join(dir, newBase + name.slice(oldBase.length))
      out.push({ fileId: null, kind: 'subtitle', titleKey: key, from, to, fromName: name, toName: win32.basename(to), status: await this.statusOf(from, to), parent })
    }
    return out
  }

  /** Renames exactly the approved items that are still what the preview showed. */
  apply(req: RenameApplyRequest, templates: { movie: string; episode: string }): Promise<RenameApplyResult> {
    return this.exclusive(async () => {
      const preview = await this.preview(req, templates)
      const wanted = new Set(req.approved.map((a) => `${a.from}\u0000${a.to}`))
      const todo: RenameItem[] = []
      let changed = 0
      for (const a of req.approved) {
        const item = preview.items.find((i) => i.from === a.from && i.to === a.to && i.status === 'ok')
        if (!item) changed++
      }
      for (const i of preview.items) if (wanted.has(`${i.from}\u0000${i.to}`) && i.status === 'ok') todo.push(i)
      if (todo.length === 0) return { batch: null, changed }

      const { batchId, rows } = this.d.journal.begin(todo.map((t) => ({ kind: t.kind, fileId: t.fileId, from: t.from, to: t.to })), this.now())
      let skipSubtitlesOf: string | null = null
      for (const row of rows) {
        if (row.kind === 'subtitle' && skipSubtitlesOf !== null && row.from.toLowerCase().startsWith(skipSubtitlesOf)) {
          this.d.journal.mark(row.id, 'failed', 'Skipped because its video could not be renamed', this.now())
          continue
        }
        const error = await this.renameOne(row)
        if (error === null) {
          this.d.journal.mark(row.id, 'done', null, this.now())
        } else {
          this.d.journal.mark(row.id, 'failed', error, this.now())
          this.d.logger.warn({ from: row.from, to: row.to, error }, 'A rename failed')
          if (row.kind === 'video') skipSubtitlesOf = win32.join(win32.dirname(row.from), win32.basename(row.from, win32.extname(row.from))).toLowerCase()
        }
        if (row.kind === 'video' && error === null) skipSubtitlesOf = null
      }
      this.d.logger.info({ batchId, count: rows.length }, 'Files renamed')
      return { batch: this.d.journal.batch(batchId), changed }
    })
  }

  private libraryPath(fileId: number): string | null {
    return (this.d.raw.prepare('SELECT path FROM media_file WHERE id = ?').get(fileId) as { path: string } | undefined)?.path ?? null
  }

  /** Renames one file and keeps the library in step. Returns an error message, or null on success. */
  private async renameOne(row: JournalRow): Promise<string | null> {
    try {
      if (!(await this.fs.exists(row.from))) return 'The file is no longer there'
      if (!sameName(row.from, row.to) && (await this.fs.exists(row.to))) return 'Something with that name already exists'
      await this.fs.rename(row.from, row.to)
    } catch (err) {
      return friendly(err)
    }
    if (row.kind === 'video' && row.fileId !== null) {
      try {
        this.d.files.updateMany([{ id: row.fileId, patch: { path: row.to } }])
      } catch (err) {
        // The library could not take the new name: put the file back so the two stay in agreement.
        await this.fs.rename(row.to, row.from).catch(() => undefined)
        return `The library could not be updated (${friendly(err)}); the rename was undone`
      }
    }
    return null
  }

  /** Undoes a batch: renames everything it renamed back, as far as that is still safe. */
  undo(batchId: string): Promise<OperationBatch | null> {
    return this.exclusive(async () => {
      const rows = this.d.journal.rows(batchId)
      if (rows.length === 0) return null
      for (const row of [...rows].reverse()) {
        if (row.status !== 'done') continue
        let error: string | null = null
        try {
          if (!(await this.fs.exists(row.to))) error = 'The renamed file is no longer there'
          else if (!sameName(row.from, row.to) && (await this.fs.exists(row.from))) error = 'Something else now has the original name'
          else {
            await this.fs.rename(row.to, row.from)
            if (row.kind === 'video' && row.fileId !== null) {
              const current = this.libraryPath(row.fileId)
              if (current !== null && sameName(current, row.to)) this.d.files.updateMany([{ id: row.fileId, patch: { path: row.from } }])
            }
          }
        } catch (err) {
          error = friendly(err)
        }
        this.d.journal.mark(row.id, error === null ? 'rolled_back' : 'rollback_failed', error, this.now())
      }
      this.d.logger.info({ batchId }, 'Renames undone')
      return this.d.journal.batch(batchId)
    })
  }

  /**
   * After a crash: a rename that was written but never marked finished either happened or did not. Look at the
   * disk, record the truth, and make the library agree with it.
   */
  async recover(): Promise<number> {
    let settled = 0
    for (const batchId of this.d.journal.interruptedBatches()) {
      for (const row of this.d.journal.rows(batchId)) {
        if (row.status !== 'pending') continue
        const toExists = await this.fs.exists(row.to).catch(() => false)
        const fromExists = await this.fs.exists(row.from).catch(() => false)
        if (toExists && (!fromExists || sameName(row.from, row.to))) {
          if (row.kind === 'video' && row.fileId !== null) {
            const current = this.libraryPath(row.fileId)
            if (current !== null && sameName(current, row.from)) this.d.files.updateMany([{ id: row.fileId, patch: { path: row.to } }])
          }
          this.d.journal.mark(row.id, 'done', null, this.now())
        } else if (fromExists) {
          this.d.journal.mark(row.id, 'failed', 'Interrupted before the rename happened; the file was left as it was', this.now())
        } else {
          this.d.journal.mark(row.id, 'failed', 'Interrupted, and neither name exists now', this.now())
        }
        settled++
      }
    }
    if (settled > 0) this.d.logger.warn({ settled }, 'Settled renames that were interrupted by a restart')
    return settled
  }
}

function friendly(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EPERM' || code === 'EACCES') return 'Access was denied (the file may be open in a player, or Theama\'s service account may not be allowed to change it)'
  if (code === 'EBUSY') return 'The file is in use by another program'
  if (code === 'ENOENT') return 'The file is no longer there'
  if (code === 'EXDEV') return 'The name is on a different drive'
  return err instanceof Error ? err.message : String(err)
}
