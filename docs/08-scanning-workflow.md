# 08 · Media scanning workflow — **Built** (Phase 2)

Implemented in `apps/server/src/scan/`: `walk.ts` (directory walk), `filename.ts` (name parser), `scanner.ts` (reconciliation), `probe.ts` (FFprobe), `manager.ts` (job queue), `auto.ts` (watchers and triggers), `store.ts` (repositories). The text below is the design; where the implementation differs it is noted in **Implementation notes** at the end.

Foundations: `library_source` (with `volume_id`, `availability`, `last_seen_online_at`), `scan_job` (persisted status + diagnostics), job/progress channel (WebSocket), service-event and log infrastructure.

## 1. Flow

```mermaid
flowchart TD
  A[Scan requested / watcher event / schedule / source back online] --> B{Source reachable?}
  B -- no --> O[Mark source offline, keep everything, log, stop]
  B -- yes --> V{Volume id matches\nthe recorded one?}
  V -- no --> O
  V -- yes --> C[Create scan_job running]
  C --> D[Walk tree: recursive, exclusions, extensions,\nskip reparse points / symlink loops, dedupe overlapping sources]
  D --> E[Per file: stat size + mtime + file id]
  E --> F{Known file identity?}
  F -- same path, same size/mtime --> G[Unchanged: skip]
  F -- same file id, new path --> H[Moved/renamed: update path, keep title + progress]
  F -- new --> I[New: queue for probe + identification]
  F -- changed content --> J[Re-probe]
  D --> K[Paths in DB not seen]
  K --> L{Source online?}
  L -- yes --> M[missing_unconfirmed, with grace period]
  L -- no --> O
  I & J --> P[FFprobe in bounded worker pool → technical info]
  P --> Q["Identification pipeline, see 07"]
  Q --> R[Persist, finish scan_job with counts + diagnostics, emit events]
```

## 2. Incremental scanning
- A file is skipped when `(path, size, mtime)` match the last scan. Only new/changed files hit FFprobe and the matcher, which also keeps provider requests low.
- Probing and matching run in a **bounded worker pool** (default `min(4, cores-1)`), never on the Electron main process and never blocking the API event loop. Jobs are **cancellable** and **resumable**: progress is persisted, so a crash or reboot resumes instead of restarting.
- Progress is pushed over WebSocket (`scan.progress`: found / probed / matched / errors) and shown by `ScanProgressIndicator`.

## 3. Detecting add / remove / move / rename
- **Identity** = volume serial + NTFS file id (`fs.stat` `dev`/`ino` as BigInt) plus size. Same id on the same volume at a new path ⇒ **move/rename** (title, metadata, collections, progress preserved).
- Cross-volume moves have no stable id: fall back to (size + name-similarity + probe duration) and mark as *probable move* needing no user action only if unambiguous; otherwise the old file goes `missing_unconfirmed` and the new one is treated as new, and the user can merge.
- **Filesystem watcher** (`fs.watch` recursive on Windows) feeds a debounced queue (2 s quiet period) that triggers targeted rescans of the affected directories, never a full scan. Watchers are not relied upon for correctness: a periodic reconcile scan catches missed events (network shares, sleep/resume).

## 4. Offline media and disconnected drives
- **Reachability check before every scan**: root `stat`, then compare the root's volume serial with `volume_id`. An unreachable root **or a different volume mounted at the same drive letter** ⇒ source `offline`.
- When a source is offline nothing is deleted or downgraded. Its files keep their state; titles show dimmed with "Offline — drive E: disconnected" and Play disabled.
- **Coming back online** is detected by the watcher on the parent, a poll (30 s backoff to 5 min) and by device-change events; the source flips to `online`, an incremental scan runs, and the user gets a toast ("E: reconnected — 2 changes found").
- **Same drive, new letter**: removable drives take whatever letter is free. On each availability poll, an offline source with a recorded serial is probed at the same folder path on every other drive letter; if exactly one volume carries the recorded serial, the source is **relinked** (all stored file and exclusion paths are re-rooted, and the title keys of personal videos/extras, which embed the path, are rewritten with them so metadata, collections and progress follow) and rescanned. Several matching drives (a cloned disk) or a network path are never guessed: the source stays offline and a log line says so.
- **Manual relocation** (`POST /library/sources/:id/relocate`, "Change location" on an offline folder) does the same re-rooting to a path the person picks, for a reformatted/new disk or a source with no recorded serial. The new path may not overlap the old one or another source; files not found there are flagged missing by the next scan, never deleted.
- Only when a source is **online** and a file is absent does a file become `missing_unconfirmed`. It becomes `removed` only on user confirmation or after the grace period (default 30 days).
- Titles with several files play the available copy; the badge says "1 of 2 versions available".
- Disconnected network shares behave the same (timeouts bounded so a dead share cannot stall the scanner).

## 5. Safety rules
- Windows path handling: long paths (`\\?\`), Unicode (incl. Greek) names, case-insensitive comparison, trailing dots/spaces.
- **Overlapping sources** (`D:\Movies` and `D:\Movies\Marvel`) are detected on add; files are indexed once, attributed to the most specific source.
- **Symlink / junction / reparse-point loops** are not followed (`lstat` + visited-id set).
- **Permission denied / corrupt media / locked file** ⇒ per-file diagnostic in `scan_job.diagnostics`, the scan continues.
- Removing a source never touches files on disk.

## 6. Failure recovery
- Process killed mid-scan: on startup, `scan_job` rows still `running` are marked `interrupted` and resumed.
- DB locked: bounded retries with backoff (WAL + busy timeout already set).
- Probe failures: retried once, then recorded; the file remains listed with minimal info.
- Every scan writes a summary line to the log history, visible in Settings → Advanced → Log history.## 7. Implementation notes (what was actually built)
- **One walk, one reconcile.** Every scan walks the whole folder (cheap: 131 files in 0.1 s on a real network-attached series folder), then compares with the database; unchanged `(size, mtime)` files are skipped and never probed. Nothing is written for unchanged files.
- **Per-directory listing** (`readdir` with file types) instead of one stat per entry; every filesystem call is bounded by a 3 s timeout so a dead share cannot hang a scan. Unreadable directories are recorded in the scan's diagnostics and files under them are **never** flagged missing.
- **Symlinks and junctions are skipped** (verified with a looping junction in tests); recursion is capped at 64 levels.
- **Rename/move detection** matches on `(volume serial, NTFS file id, size)`; the row, its probe data and its history are kept.
- **Missing files** are flagged `missing_unconfirmed` only if the folder is still online *after* the walk; a cancelled, failed or unreachable scan changes nothing. Nothing is ever deleted: `removed` and its grace-period clean-up are not built yet.
- **Overlapping folders:** a folder nested inside another source is excluded from the parent's walk, so each file is indexed once.
- **FFprobe** runs as bounded child processes (≤ 4, `cores − 1`), 30 s timeout, arguments as an array after `--`. A file FFprobe cannot read keeps its row with `probe_error` (shown as *Unreadable*) and is not retried while unchanged. Without FFprobe the scan still lists files and says why details are missing.
- **Triggers** (`auto.ts`): service start (every enabled folder), folder added / re-enabled / type changed, **Scan now**, a folder coming back online (60 s availability poll), `fs.watch` events (2 s debounce, one scan per burst), and a 6-hour safety rescan. A watcher that errors (drive pulled) is dropped and re-attached by the next poll.
- **Jobs** are persisted; scans left `running` by a crash are marked failed ("interrupted") on startup and the folders are scanned again.
- **Not yet built:** exclusion patterns, per-folder extension lists, the grace-period `removed` state, targeted (per-directory) rescans, change journal (USN) based watching.
