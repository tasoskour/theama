import { promises as fs, constants } from 'node:fs'
import { isAbsolute, normalize, parse, win32 } from 'node:path'
import { eq } from 'drizzle-orm'
import type { LibrarySource, LibraryType, SourceAvailability, UpdateSourceRequest } from '@theama/contracts'
import type { Db } from '../db/client'
import { librarySource } from '../db/schema'

/** An error the API reports with a stable code and HTTP status. */
export class ApiProblem extends Error {
  constructor(
    readonly apiCode: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'ApiProblem'
  }
}

/** A dead network share can block stat() for a long time; never wait on it for more than this. */
export const FS_TIMEOUT_MS = 3000

function withTimeout<T>(work: Promise<T>, ms = FS_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for the folder (is the drive or share connected?)')), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** Lowercased, normalised form used to detect the same folder added twice (Windows paths are case-insensitive). */
export function pathKey(path: string): string {
  return stripTrailingSeparator(normalize(path)).toLowerCase()
}

function stripTrailingSeparator(p: string): string {
  const root = parse(p).root
  return p.length > root.length ? p.replace(/[\\/]+$/, '') : p
}

/** Validates the shape of a folder path (no I/O). Returns the normalised path. */
export function normaliseFolderPath(raw: string): string {
  const path = raw.trim()
  // eslint-disable-next-line no-control-regex
  if (path.length === 0 || /[\u0000-\u001f]/.test(path)) throw new ApiProblem('invalid_path', 'The folder path is empty or contains invalid characters', 400)
  if (!isAbsolute(path) && !win32.isAbsolute(path)) throw new ApiProblem('invalid_path', 'Use a full folder path such as D:\\Movies', 400)
  if (/^\\\\[?.]\\/.test(path)) throw new ApiProblem('invalid_path', 'Device paths are not supported', 400)
  if (path.split(/[\\/]+/).includes('..')) throw new ApiProblem('invalid_path', 'The folder path must not contain ".." segments', 400)
  return stripTrailingSeparator(normalize(path))
}

export interface FolderProbe {
  /** Windows volume serial number of the drive holding the folder. */
  volumeId: string
}

/** Checks the folder exists, is a directory and is readable by the account the service runs as. */
export async function probeFolder(path: string): Promise<FolderProbe> {
  try {
    const stat = await withTimeout(fs.stat(path, { bigint: true }))
    if (!stat.isDirectory()) throw new ApiProblem('not_a_directory', 'That path is a file, not a folder', 400)
    await withTimeout(fs.access(path, constants.R_OK))
    return { volumeId: stat.dev.toString() }
  } catch (err) {
    if (err instanceof ApiProblem) throw err
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new ApiProblem('not_found', 'That folder does not exist or its drive is not connected', 400)
    if (code === 'EACCES' || code === 'EPERM') {
      throw new ApiProblem(
        'permission_denied',
        'The Theama service is not allowed to read that folder. Check the account the service runs as (Settings → Advanced → Service).',
        400,
      )
    }
    throw new ApiProblem('unreachable', err instanceof Error ? err.message : 'The folder could not be reached', 400)
  }
}

export interface AvailabilityResult {
  availability: SourceAvailability
  volumeId: string | null
}

/**
 * Decides whether a source is online. A folder whose volume serial differs from
 * the one recorded when it was added is a *different disk* under the same path,
 * so it counts as offline (nothing under it may be trusted or deleted).
 */
export async function checkAvailability(
  path: string,
  recordedVolumeId: string | null,
  probe: (p: string) => Promise<FolderProbe> = probeFolder,
): Promise<AvailabilityResult> {
  try {
    const { volumeId } = await probe(path)
    if (recordedVolumeId && volumeId !== recordedVolumeId) return { availability: 'offline', volumeId }
    return { availability: 'online', volumeId }
  } catch {
    return { availability: 'offline', volumeId: null }
  }
}

type Row = typeof librarySource.$inferSelect

function toSource(row: Row): LibrarySource {
  return {
    id: row.id,
    path: row.path,
    libraryType: row.libraryType,
    recursive: row.recursive,
    enabled: row.enabled,
    volumeId: row.volumeId,
    availability: row.availability,
    lastSeenOnlineAt: row.lastSeenOnlineAt,
    createdAt: row.createdAt,
  }
}

export class LibrarySourceRepo {
  constructor(private readonly db: Db) {}

  list(): LibrarySource[] {
    return this.db.select().from(librarySource).orderBy(librarySource.id).all().map(toSource)
  }

  get(id: number): LibrarySource | null {
    const row = this.db.select().from(librarySource).where(eq(librarySource.id, id)).get()
    return row ? toSource(row) : null
  }

  create(input: { path: string; libraryType: LibraryType; recursive: boolean; volumeId: string }): LibrarySource {
    const key = pathKey(input.path)
    if (this.list().some((s) => pathKey(s.path) === key)) {
      throw new ApiProblem('source_exists', 'That folder has already been added', 409)
    }
    const now = new Date().toISOString()
    const row = this.db
      .insert(librarySource)
      .values({
        path: input.path,
        libraryType: input.libraryType,
        recursive: input.recursive,
        enabled: true,
        volumeId: input.volumeId,
        availability: 'online',
        lastSeenOnlineAt: now,
        createdAt: now,
      })
      .returning()
      .get()
    return toSource(row)
  }

  update(id: number, patch: UpdateSourceRequest): LibrarySource {
    const values: Partial<typeof librarySource.$inferInsert> = {}
    if (patch.libraryType !== undefined) values.libraryType = patch.libraryType
    if (patch.recursive !== undefined) values.recursive = patch.recursive
    if (patch.enabled !== undefined) values.enabled = patch.enabled
    if (Object.keys(values).length > 0) this.db.update(librarySource).set(values).where(eq(librarySource.id, id)).run()
    const updated = this.get(id)
    if (!updated) throw new ApiProblem('not_found', 'No such library folder', 404)
    return updated
  }

  /** Removes the source from Theama. Files on disk are never touched. */
  remove(id: number): boolean {
    return this.db.delete(librarySource).where(eq(librarySource.id, id)).run().changes > 0
  }

  setAvailability(id: number, availability: SourceAvailability, seenOnline: boolean): void {
    this.db
      .update(librarySource)
      .set(seenOnline ? { availability, lastSeenOnlineAt: new Date().toISOString() } : { availability })
      .where(eq(librarySource.id, id))
      .run()
  }
}

/** Re-checks every source concurrently (each bounded by a timeout) and persists changes. */
export async function refreshAvailability(repo: LibrarySourceRepo): Promise<LibrarySource[]> {
  const sources = repo.list()
  await Promise.all(
    sources.map(async (s) => {
      const result = await checkAvailability(s.path, s.volumeId)
      if (result.availability !== s.availability || result.availability === 'online') {
        repo.setAvailability(s.id, result.availability, result.availability === 'online')
      }
    }),
  )
  return repo.list()
}
