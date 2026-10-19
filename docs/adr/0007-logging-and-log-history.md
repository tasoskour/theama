# ADR-0007 — Structured NDJSON logs, rotation, and a reader shared with the shell

**Status:** accepted · 2026-10-19

**Context.** The user wants a log history in the UI. Logs must also be readable when the service is down (that is exactly when they are needed), and NSSM captures raw stdout/stderr separately.

**Decision.**
- **pino** → NDJSON files `theama-YYYY-MM-DD-NNN.ndjson` in `<data>\logs`, **synchronous appends** (low volume; the last line survives a crash), roll at **10 MB** and daily, prune after a configurable retention (default 14 days).
- An in-memory **ring** (500 lines) feeds a WebSocket `log.appended` live tail.
- Under the service host the app logger does **not** write to stdout (NSSM owns stdout/stderr and keeps them in `service-stdout.log` / `service-stderr.log`, rotated at 5 MB); in foreground mode it prints readable lines.
- Writing, parsing and paging live in **`packages/logs`**, used by the server for `GET /logs` *and* by the desktop shell for `logs.readLocal` when the API is unreachable.
- Paging is **cursor-based** (`file + line index`, newest first across rotated files) so the history is stable while new lines append.
- NSSM output files have no timestamps; entries use the file's modification time and the UI says so.

**Consequences.** Reading a day's file to page is O(file size) per request — fine at 10 MB files; revisit with an index if logs grow. Error `context` is whatever pino serialises; no PII is logged by design (paths appear only where needed for diagnosis).
