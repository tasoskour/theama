import type { LibrarySource } from '@theama/contracts'
import { ApiProblem, pathKey, probeFolder, type FolderProbe } from './sources'

const DRIVE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DRIVE_PREFIX = /^([A-Za-z]):(?=[\\/]|$)/

export type Relocation =
  | { kind: 'none' }
  | { kind: 'found'; path: string; volumeId: string }
  /** Several drives carry the same serial (a cloned disk): which one is meant is the person's call. */
  | { kind: 'ambiguous'; paths: string[] }

/**
 * Looks for a folder whose drive came back under another letter. Removable drives get whatever letter is free,
 * so the same folder path on every other letter is probed and accepted only if it lives on a volume with the
 * serial recorded when the folder was added. Network paths and folders without a recorded serial cannot be matched.
 */
export async function findRelocation(
  source: Pick<LibrarySource, 'path' | 'volumeId'>,
  takenPaths: readonly string[] = [],
  probe: (p: string) => Promise<FolderProbe> = probeFolder,
): Promise<Relocation> {
  const drive = DRIVE_PREFIX.exec(source.path)
  if (!drive || !source.volumeId) return { kind: 'none' }
  const current = drive[1]!.toUpperCase()
  const taken = new Set(takenPaths.map(pathKey))
  const tail = source.path.slice(2)
  const probed = await Promise.all(
    [...DRIVE_LETTERS]
      .filter((letter) => letter !== current)
      .map((letter) => `${letter}:${tail}`)
      .filter((candidate) => !taken.has(pathKey(candidate)))
      .map(async (candidate) => {
        try {
          const { volumeId } = await probe(candidate)
          return volumeId === source.volumeId ? { path: candidate, volumeId } : null
        } catch {
          return null
        }
      }),
  )
  const matches = probed.filter((m): m is { path: string; volumeId: string } => m !== null)
  if (matches.length === 0) return { kind: 'none' }
  if (matches.length > 1) return { kind: 'ambiguous', paths: matches.map((m) => m.path) }
  return { kind: 'found', ...matches[0]! }
}

const contains = (outer: string, inner: string): boolean => {
  const o = pathKey(outer)
  const i = pathKey(inner)
  return i === o || i.startsWith(o.endsWith('\\') ? o : o + '\\')
}

/**
 * Rejects a new location that cannot be swapped in safely: another folder already uses it, or it overlaps the old
 * one (the stored paths would collide while they are rewritten).
 */
export function assertRelocatable(source: Pick<LibrarySource, 'id' | 'path'>, newPath: string, others: readonly Pick<LibrarySource, 'id' | 'path'>[]): void {
  if (pathKey(newPath) === pathKey(source.path)) throw new ApiProblem('same_path', 'That is already this folder\'s location', 400)
  if (others.some((o) => o.id !== source.id && pathKey(o.path) === pathKey(newPath))) {
    throw new ApiProblem('source_exists', 'That folder has already been added', 409)
  }
  if (contains(source.path, newPath) || contains(newPath, source.path)) {
    throw new ApiProblem('invalid_path', 'The new location must not be inside the current one, or contain it', 400)
  }
}
