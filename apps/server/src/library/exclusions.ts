import { eq } from 'drizzle-orm'
import type { ExclusionKind, LibraryExclusion } from '@theama/contracts'
import type { Db } from '../db/client'
import { libraryExclusion, mediaFile } from '../db/schema'
import { ApiProblem, LibrarySourceRepo, normaliseFolderPath, pathKey } from './sources'

type Row = typeof libraryExclusion.$inferSelect

const toExclusion = (row: Row): LibraryExclusion => ({
  id: row.id,
  sourceId: row.sourceId,
  path: row.path,
  kind: row.kind,
  createdAt: row.createdAt,
})

function isInside(path: string, root: string): boolean {
  const candidate = pathKey(path)
  const parent = pathKey(root)
  return candidate !== parent && (candidate.startsWith(`${parent}\\`) || candidate.startsWith(`${parent}/`))
}

function matches(path: string, exclusion: Pick<LibraryExclusion, 'path' | 'kind'>): boolean {
  const candidate = pathKey(path)
  const excluded = pathKey(exclusion.path)
  return candidate === excluded || (exclusion.kind === 'folder' && (candidate.startsWith(`${excluded}\\`) || candidate.startsWith(`${excluded}/`)))
}

/** Persists scan exclusions and keeps already-indexed rows reversible via media_file.excluded. */
export class LibraryExclusionRepo {
  constructor(
    private readonly db: Db,
    private readonly library: LibrarySourceRepo,
  ) {}

  list(sourceId: number): LibraryExclusion[] {
    return this.db.select().from(libraryExclusion).where(eq(libraryExclusion.sourceId, sourceId)).orderBy(libraryExclusion.path).all().map(toExclusion)
  }

  create(sourceId: number, rawPath: string, kind: ExclusionKind): LibraryExclusion {
    const source = this.library.get(sourceId)
    if (!source) throw new ApiProblem('not_found', 'No such library folder', 404)
    const path = normaliseFolderPath(rawPath)
    if (!isInside(path, source.path)) throw new ApiProblem('outside_source', 'Choose a file or subfolder inside this media folder', 400)
    const existing = this.list(sourceId).find((e) => pathKey(e.path) === pathKey(path))
    if (existing) return existing
    const row = this.db
      .insert(libraryExclusion)
      .values({ sourceId, path, kind, createdAt: new Date().toISOString() })
      .returning()
      .get()
    this.recompute(sourceId)
    return toExclusion(row)
  }

  /** Hides every currently visible file of a card and makes that choice survive rescans. */
  hideTitle(titleKey: string): number {
    const rows = this.db.select({ sourceId: mediaFile.sourceId, path: mediaFile.path }).from(mediaFile)
      .where(eq(mediaFile.titleKey, titleKey)).all()
    const sourceIds = new Set(rows.map((row) => row.sourceId))
    for (const sourceId of sourceIds) {
      const known = new Set(this.list(sourceId).map((e) => pathKey(e.path)))
      for (const row of rows.filter((candidate) => candidate.sourceId === sourceId)) {
        if (known.has(pathKey(row.path))) continue
        this.db.insert(libraryExclusion).values({ sourceId, path: row.path, kind: 'file', createdAt: new Date().toISOString() }).run()
        known.add(pathKey(row.path))
      }
      this.recompute(sourceId)
    }
    return rows.length
  }

  hideFile(id: number): number {
    const row = this.db.select({ sourceId: mediaFile.sourceId, path: mediaFile.path }).from(mediaFile).where(eq(mediaFile.id, id)).get()
    if (!row) throw new ApiProblem('not_found', 'No such media file', 404)
    this.create(row.sourceId, row.path, 'file')
    return 1
  }

  remove(id: number): LibraryExclusion | null {
    const row = this.db.select().from(libraryExclusion).where(eq(libraryExclusion.id, id)).get()
    if (!row) return null
    this.db.delete(libraryExclusion).where(eq(libraryExclusion.id, id)).run()
    this.recompute(row.sourceId)
    return toExclusion(row)
  }

  /** Re-evaluates rows after adding/removing a rule; no media or playback history is deleted. */
  private recompute(sourceId: number): void {
    const exclusions = this.list(sourceId)
    const rows = this.db.select({ id: mediaFile.id, path: mediaFile.path, excluded: mediaFile.excluded }).from(mediaFile)
      .where(eq(mediaFile.sourceId, sourceId)).all()
    for (const row of rows) {
      const excluded = exclusions.some((e) => matches(row.path, e))
      if (excluded !== row.excluded) this.db.update(mediaFile).set({ excluded }).where(eq(mediaFile.id, row.id)).run()
    }
  }
}
