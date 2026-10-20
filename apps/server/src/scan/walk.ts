import { promises as fs } from 'node:fs'
import { join, sep } from 'node:path'
import { pathKey, withTimeout } from '../library/sources'
import { isVideoFileName } from './filename'

export interface WalkedFile {
  /** Absolute path as found on disk. */
  path: string
  /** Folder names below the root, then the file name. */
  relative: string[]
  size: number
  mtimeMs: number
  /** Windows volume serial number. */
  volumeId: string
  /** NTFS file id: survives renames and moves on the same volume. null when the file system gives none (FAT, some shares). */
  fileId: string | null
}

export interface WalkReport {
  /** Directories that could not be listed. Files below them must not be treated as missing. */
  unreadableDirs: string[]
  diagnostics: string[]
  /** The walk was stopped before it finished (cancelled). Its result is incomplete and must not be reconciled. */
  aborted: boolean
}

export interface WalkOptions {
  root: string
  recursive: boolean
  /** Roots of other library folders nested inside this one: they belong to their own source. */
  excludeRoots?: readonly string[]
  /** Individual files deliberately hidden by the person. */
  excludeFiles?: readonly string[]
  extensions?: ReadonlySet<string>
  isCancelled?: () => boolean
  onFile: (file: WalkedFile) => void
  /** Called every N files so callers can report progress. */
  onTick?: (found: number) => void
}

const MAX_DEPTH = 64

/** Walks a folder tree without following symlinks or junctions, never throwing for a single bad entry. */
export async function walkTree(options: WalkOptions): Promise<WalkReport> {
  const report: WalkReport = { unreadableDirs: [], diagnostics: [], aborted: false }
  const excluded = new Set((options.excludeRoots ?? []).map(pathKey))
  const excludedFiles = new Set((options.excludeFiles ?? []).map(pathKey))
  let found = 0

  const note = (message: string): void => {
    if (report.diagnostics.length < 50) report.diagnostics.push(message)
  }

  async function visit(dir: string, relative: string[], depth: number): Promise<void> {
    if (options.isCancelled?.()) {
      report.aborted = true
      return
    }
    if (depth > MAX_DEPTH) {
      note(`Not descending into ${dir}: nested more than ${MAX_DEPTH} levels`)
      return
    }
    let entries: import('node:fs').Dirent[]
    try {
      // Dirent[] for one folder at a time keeps memory flat on huge libraries.
      entries = await withTimeout(fs.readdir(dir, { withFileTypes: true }))
    } catch (err) {
      report.unreadableDirs.push(dir)
      note(`Could not read ${dir}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`)
      return
    }

    const subdirs: import('node:fs').Dirent[] = []
    for (const entry of entries) {
      if (options.isCancelled?.()) {
        report.aborted = true
        return
      }
      // Symlinks and junctions are skipped: they can loop and would index the same files twice.
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        subdirs.push(entry)
        continue
      }
      if (!entry.isFile() || !isVideoFileName(entry.name, options.extensions)) continue
      const path = join(dir, entry.name)
      if (excludedFiles.has(pathKey(path))) continue
      try {
        const st = await withTimeout(fs.stat(path, { bigint: true }))
        found++
        options.onFile({
          path,
          relative: [...relative, entry.name],
          size: Number(st.size),
          mtimeMs: Number(st.mtimeMs),
          volumeId: st.dev.toString(),
          fileId: st.ino === 0n ? null : st.ino.toString(),
        })
        if (found % 200 === 0) options.onTick?.(found)
      } catch (err) {
        note(`Could not read ${path}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`)
      }
    }

    if (!options.recursive) return
    subdirs.sort((a, b) => a.name.localeCompare(b.name))
    for (const sub of subdirs) {
      const subPath = dir.endsWith(sep) ? dir + sub.name : dir + sep + sub.name
      if (excluded.has(pathKey(subPath))) continue
      await visit(subPath, [...relative, sub.name], depth + 1)
      if (report.aborted) return
    }
  }

  await visit(options.root, [], 0)
  options.onTick?.(found)
  return report
}
