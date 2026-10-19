import type Database from 'better-sqlite3'
import type { CollectionRef } from '@theama/contracts'

/**
 * The collections a library title is in: the person's own (by title key) and the provider's official
 * sets (by the movie the title was identified as). Kept apart from CollectionRepo so TitleRepo can use it.
 */
export function collectionRefsFor(raw: Database.Database, key: string): CollectionRef[] {
  return raw
    .prepare(
      `SELECT c.id AS id, c.kind AS kind, c.name AS name
         FROM collection c JOIN collection_member m ON m.collection_id = c.id
        WHERE c.kind = 'user' AND m.title_key = @key
       UNION
       SELECT c.id, c.kind, c.name
         FROM collection c
         JOIN collection_member m ON m.collection_id = c.id
         JOIN title_match tm ON tm.external_id = m.external_id AND tm.provider = c.provider
        WHERE c.kind = 'official' AND tm.kind = 'movie' AND tm.state = 'matched' AND tm.title_key = @key
       ORDER BY kind DESC, name COLLATE NOCASE`,
    )
    .all({ key }) as CollectionRef[]
}
