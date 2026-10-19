# ADR-0003 — SQLite (better-sqlite3) + Drizzle, hand-written embedded migrations

**Status:** accepted · 2026-10-19

**Context.** Local-first, single-user data: relational, needs transactions, FTS, and zero administration. The brief suggests SQLite and Drizzle or similar.

**Decision.**
- **better-sqlite3 13** (synchronous, fast, N-API prebuilds incl. FTS5), WAL, `foreign_keys=ON`, `busy_timeout=5000`.
- **Drizzle ORM** for typed queries and schema declarations.
- Migrations are **hand-written SQL strings** in `apps/server/src/db/migrations.ts`, applied in order inside a transaction using `PRAGMA user_version`. We do not use drizzle-kit's generated migration folder.
- A test (`schema-drift.test.ts`) compares Drizzle's declared columns with the migrated database.
- A database with a higher `user_version` than the build knows is **refused** with a clear message.

**Why not drizzle-kit migrations.** The server is bundled to a single file; a migrations *folder* would have to be shipped and located at runtime. Embedded strings travel with the bundle. The drift test removes the main downside (two sources of truth).

**Consequences.** New tables/columns require writing SQL and updating `schema.ts`; the drift test fails if they disagree. Released migrations are immutable. Synchronous DB calls block the event loop briefly, which is acceptable for local single-user queries; heavy work (scanning/probing) runs in worker threads in Phase 2.
