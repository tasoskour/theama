# ADR-0008 — Absent media is a state, never a deletion

**Status:** accepted · 2026-10-19 (model + schema columns now; behaviour in Phase 2)

**Context.** Users keep media on external drives and network shares that are often disconnected. Treating "file not found" as "deleted" would destroy metadata, manual corrections and watch progress.

**Decision.**
- Availability is decided at the **source** first: unreachable root, or a root whose **volume serial** differs from the recorded one (a different disk under the same letter), ⇒ source `offline` ⇒ all its files `source_offline`. **No other state changes.**
- Only when the source is **online** and a file is missing does it become `missing_unconfirmed`; `removed` requires user confirmation or a grace period (default 30 days). Even `removed` drops only the file link — titles, metadata, overrides and progress remain.
- `library_source` already carries `volume_id`, `availability`, `last_seen_online_at`.
- UI: offline titles are dimmed with a reason badge, Play disabled with an explanation, filters for hide/only unavailable, per-source status, and a toast on reconnection; multi-version titles play the available copy.
- Volume identity uses `fs.stat().dev` (Windows volume serial). Theama **never writes marker files** to the user's drives.

**Consequences.** Unplugging a drive is safe and reversible. The scanner must always check reachability and volume identity before reconciling. Network-share timeouts must be bounded so a dead share cannot stall scanning (see `docs/08-scanning-workflow.md`).
