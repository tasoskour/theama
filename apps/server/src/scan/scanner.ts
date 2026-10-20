import { win32 } from 'node:path'
import { EMPTY_SUMMARY, type LibraryExclusion, type LibrarySource, type ScanPhase, type ScanSummary } from '@theama/contracts'
import { pathKey } from '../library/sources'
import { parseMediaPath, titleKeyFor } from './filename'
import { runPool, type ProbeFn } from './probe'
import type { FilePatch, FileRow, MediaFileRepo, NewFileRow } from './store'
import { walkTree, type WalkedFile } from './walk'

export interface ScanContext {
  source: LibrarySource
  /** Roots of other library folders nested inside this one; they are scanned as their own source. */
  nestedRoots: string[]
  exclusions?: readonly LibraryExclusion[]
  files: MediaFileRepo
  /** null when FFprobe is not installed: files are listed without technical info. */
  probe: ProbeFn | null
  probeConcurrency: number
  extensions?: ReadonlySet<string>
  isCancelled: () => boolean
  /** Is the folder still reachable (and still the same volume)? Asked before and after the walk. */
  checkOnline: () => Promise<boolean>
  progress: (p: { phase: ScanPhase; found: number; toProbe: number; probed: number }) => void
  now?: () => Date
}

export interface ScanOutcome {
  status: 'done' | 'cancelled' | 'failed'
  summary: ScanSummary
  diagnostics: string[]
}

function parseFor(source: LibrarySource, file: WalkedFile) {
  const rootName = win32.basename(source.path)
  return parseMediaPath([rootName, ...file.relative], source.libraryType)
}

function parsedColumns(p: ReturnType<typeof parseFor>, path: string): Required<Pick<FilePatch, 'kind' | 'guessedTitle' | 'guessedYear' | 'season' | 'episode' | 'episodeEnd' | 'episodeTitle' | 'titleKey'>> {
  return {
    titleKey: titleKeyFor(p.kind, p.title, p.year, path),
    kind: p.kind,
    guessedTitle: p.title,
    guessedYear: p.year,
    season: p.season,
    episode: p.episode,
    episodeEnd: p.episodeEnd,
    episodeTitle: p.episodeTitle,
  }
}

const PARSED_KEYS = ['kind', 'guessedTitle', 'guessedYear', 'season', 'episode', 'episodeEnd', 'episodeTitle', 'titleKey'] as const

const isUnder = (path: string, dir: string): boolean => {
  const p = pathKey(path)
  const d = pathKey(dir)
  return p === d || p.startsWith(d.endsWith('\\') ? d : d + '\\')
}

/**
 * Scans one library folder and reconciles the database with what is on disk.
 *
 * Safety rules (ADR-0008): nothing is ever deleted; a file that disappears is only
 * *flagged* missing, and only if the folder is still online after the walk and the
 * file was not under a directory that could not be read. A cancelled or unreachable
 * scan changes nothing about existing files.
 */
export async function runScan(ctx: ScanContext): Promise<ScanOutcome> {
  const { source, files } = ctx
  const now = (ctx.now ?? (() => new Date()))().toISOString()
  const summary: ScanSummary = { ...EMPTY_SUMMARY }
  const diagnostics: string[] = []
  const cancelled = (): ScanOutcome => ({ status: 'cancelled', summary, diagnostics })

  if (!(await ctx.checkOnline())) {
    return { status: 'failed', summary, diagnostics: ['The folder cannot be reached right now (drive disconnected or a different disk is mounted there). Nothing was changed.'] }
  }

  // 1. Walk the disk.
  const walked: WalkedFile[] = []
  const report = await walkTree({
    root: source.path,
    recursive: source.recursive,
    excludeRoots: [...ctx.nestedRoots, ...(ctx.exclusions ?? []).filter((e) => e.kind === 'folder').map((e) => e.path)],
    excludeFiles: (ctx.exclusions ?? []).filter((e) => e.kind === 'file').map((e) => e.path),
    extensions: ctx.extensions,
    isCancelled: ctx.isCancelled,
    onFile: (f) => walked.push(f),
    onTick: (found) => ctx.progress({ phase: 'walking', found, toProbe: 0, probed: 0 }),
  })
  diagnostics.push(...report.diagnostics)
  summary.found = walked.length
  if (report.aborted || ctx.isCancelled()) return cancelled()

  // 2. Reconcile with the database.
  ctx.progress({ phase: 'finalizing', found: walked.length, toProbe: 0, probed: 0 })
  const existing = files.forSource(source.id)
  const byKey = new Map<string, FileRow>(existing.map((r) => [pathKey(r.path), r]))
  const seenKeys = new Set<string>()

  const toUpdate: { id: number; patch: FilePatch }[] = []
  const probeIds = new Map<number, string>() // id -> path
  const unmatched: WalkedFile[] = []

  for (const f of walked) {
    const key = pathKey(f.path)
    seenKeys.add(key)
    const row = byKey.get(key)
    if (!row) {
      unmatched.push(f)
      continue
    }
    const patch: FilePatch = {}
    const unchanged = row.size === f.size && row.mtimeMs === f.mtimeMs
    if (!unchanged) {
      Object.assign(patch, { size: f.size, mtimeMs: f.mtimeMs, volumeId: f.volumeId, fileId: f.fileId, probedAt: null, probeError: null, lastSeenAt: now })
      summary.changed++
      probeIds.set(row.id, f.path)
    } else {
      summary.skipped++
      if (row.volumeId !== f.volumeId || row.fileId !== f.fileId) Object.assign(patch, { volumeId: f.volumeId, fileId: f.fileId })
    }
    if (row.state === 'missing_unconfirmed') {
      Object.assign(patch, { state: 'available' as const, missingSince: null, lastSeenAt: now })
      if (unchanged) summary.changed++
    }
    const parsed = parsedColumns(parseFor(source, f), f.path)
    for (const k of PARSED_KEYS) if (row[k] !== parsed[k]) Object.assign(patch, { [k]: parsed[k] })
    if (Object.keys(patch).length > 0) toUpdate.push({ id: row.id, patch })
  }

  // Rows whose path is no longer on disk.
  const unseen = existing.filter((r) => !seenKeys.has(pathKey(r.path)))

  // A file that vanished from one path and appeared at another with the same NTFS id and size was renamed or moved.
  const identity = new Map<string, FileRow[]>()
  for (const r of unseen) {
    if (!r.fileId) continue
    const k = `${r.volumeId}|${r.fileId}|${r.size}`
    identity.set(k, [...(identity.get(k) ?? []), r])
  }
  const movedRowIds = new Set<number>()
  const brandNew: WalkedFile[] = []
  for (const f of unmatched) {
    const candidates = f.fileId ? identity.get(`${f.volumeId}|${f.fileId}|${f.size}`) : undefined
    const row = candidates?.shift()
    if (!row) {
      brandNew.push(f)
      continue
    }
    movedRowIds.add(row.id)
    summary.moved++
    const patch: FilePatch = {
      path: f.path, size: f.size, mtimeMs: f.mtimeMs, volumeId: f.volumeId, fileId: f.fileId,
      state: 'available', missingSince: null, lastSeenAt: now, ...parsedColumns(parseFor(source, f), f.path),
    }
    if (row.mtimeMs !== f.mtimeMs) {
      Object.assign(patch, { probedAt: null, probeError: null })
      probeIds.set(row.id, f.path)
    }
    toUpdate.push({ id: row.id, patch })
  }

  // 3. Files that disappeared: flag, never delete, and only when we are sure the folder is still there.
  const candidates = unseen.filter((r) => !r.excluded && r.state === 'available' && !movedRowIds.has(r.id) && !report.unreadableDirs.some((d) => isUnder(r.path, d)))
  let stillOnline = true
  if (candidates.length > 0) {
    stillOnline = await ctx.checkOnline()
    if (!stillOnline) diagnostics.push('The folder went offline during the scan, so no files were marked missing.')
  }
  if (ctx.isCancelled()) return cancelled()

  // 4. Persist.
  const newRows: NewFileRow[] = brandNew.map((f) => ({
    sourceId: source.id, path: f.path, size: f.size, mtimeMs: f.mtimeMs, volumeId: f.volumeId, fileId: f.fileId,
    state: 'available', firstSeenAt: now, lastSeenAt: now, ...parsedColumns(parseFor(source, f), f.path),
  }))
  for (let i = 0; i < newRows.length; i += 500) {
    const batch = newRows.slice(i, i + 500)
    const ids = files.insertMany(batch)
    ids.forEach((id, n) => probeIds.set(id, batch[n]!.path))
  }
  summary.new = newRows.length
  for (let i = 0; i < toUpdate.length; i += 500) files.updateMany(toUpdate.slice(i, i + 500))
  if (stillOnline && candidates.length > 0) {
    files.markMissing(candidates.map((r) => r.id), now)
    summary.missing = candidates.length
  }

  // Files never probed (an earlier scan was interrupted, or FFprobe was installed later).
  if (ctx.probe) {
    for (const r of existing) {
      // Never probed, or probed before stream details were stored (tracks is null): read it (again) once.
      const needsProbe = r.probedAt === null || r.tracks === null
      if (r.state === 'available' && needsProbe && r.probeError === null && seenKeys.has(pathKey(r.path)) && !probeIds.has(r.id)) {
        probeIds.set(r.id, r.path)
      }
    }
  }

  // 5. Technical info via FFprobe.
  if (!ctx.probe) {
    if (probeIds.size > 0) diagnostics.push('FFprobe was not found, so duration, resolution and codecs are not available. Run "yarn ffprobe:fetch".')
    return { status: 'done', summary, diagnostics }
  }
  const queue = [...probeIds.entries()]
  let probed = 0
  ctx.progress({ phase: 'probing', found: walked.length, toProbe: queue.length, probed })
  await runPool(
    queue,
    ctx.probeConcurrency,
    async ([id, path]) => {
      try {
        files.saveProbe(id, new Date().toISOString(), await ctx.probe!(path), null)
        summary.probed++
      } catch (err) {
        summary.errors++
        const message = err instanceof Error ? err.message : String(err)
        files.saveProbe(id, new Date().toISOString(), null, message)
        if (diagnostics.length < 50) diagnostics.push(`${win32.basename(path)}: ${message}`)
      }
      probed++
      ctx.progress({ phase: 'probing', found: walked.length, toProbe: queue.length, probed })
    },
    ctx.isCancelled,
  )
  return ctx.isCancelled() ? cancelled() : { status: 'done', summary, diagnostics }
}
