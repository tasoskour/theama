import type Database from 'better-sqlite3'
import { FavoriteTitle, SaveFavoriteRequest, type ProviderIdentity } from '@theama/contracts'

type Row = { snapshot: string; saved_at: string }
const fromRow = (row: Row): FavoriteTitle => FavoriteTitle.parse({ ...JSON.parse(row.snapshot), savedAt: row.saved_at })

export class FavoritesRepo {
  constructor(private readonly raw: Database.Database) {}

  list(): FavoriteTitle[] {
    const rows = this.raw.prepare('SELECT snapshot, saved_at FROM download_favorite ORDER BY saved_at DESC, provider, kind, external_id').all() as Row[]
    return rows.map(fromRow)
  }

  save(input: SaveFavoriteRequest): FavoriteTitle {
    const item = SaveFavoriteRequest.parse(input)
    this.raw.prepare(`INSERT INTO download_favorite (provider, kind, external_id, snapshot, saved_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (provider, kind, external_id) DO NOTHING`)
      .run(item.provider, item.kind, item.externalId, JSON.stringify(item), new Date().toISOString())
    const row = this.raw.prepare('SELECT snapshot, saved_at FROM download_favorite WHERE provider = ? AND kind = ? AND external_id = ?')
      .get(item.provider, item.kind, item.externalId) as Row
    return fromRow(row)
  }

  remove(item: ProviderIdentity): boolean {
    return this.raw.prepare('DELETE FROM download_favorite WHERE provider = ? AND kind = ? AND external_id = ?')
      .run(item.provider, item.kind, item.externalId).changes > 0
  }
}
