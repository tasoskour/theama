# Performance improvements — 2026-10-25

The audit covered shared library browsing, Home rails, title/collection details, search, downloads and suggestions, settings, logs, playback/subtitles, scanning, renaming, backups and immersive graphics. Existing lazy routes, bounded rails, provider throttling and lazy Three.js loading remain in place.

## Measurements

Synthetic baseline: 5,000 titles / 20,000 files. API p95: title lists 23–77 ms, search 12 ms, API during a 10,000-file scan 17.5 ms. Loading 20 Movies pages mounted 1,200 cards, grew renderer heap from 39 MB to 247 MB and DOM nodes from roughly 12,000 to 83,000. An unmatched search over 40 MB of rotated logs blocked the service thread for 0.9–1.1 seconds.

After virtualization, the dedicated renderer test loads 1,200 movies over 20 pages: 64 mounted cards, heap 24.3 → 32.0 MB, DOM nodes 6,331 → 8,286. This test uses a smaller total library than the API benchmark and synthetic missing artwork; the mounted-card bound is the primary regression assertion. Home/End navigation, details/back focus restoration, resizing and extra-large text are checked in the same test. The final recheck recorded exactly 19 additional title-page requests for those 20 pages and a 33.4 ms p95 frame interval during a one-second scripted scroll (one frame over 50 ms). This is not a demonstrated 60 fps result; real-device frame-rate profiling remains open.

The final isolated API benchmark passed every budget: repeated first-page title lists 3?13 ms p95, uncached deep pagination 84.4 ms, search 9.6 ms, API during a 10,000-file scan 10.9 ms, and API alongside three unmatched 40 MB log searches 3.6 ms. Service startup was 858 ms. A bounded page cache was added after isolated runs still showed title-list spikes above 150 ms. Cached and uncached results are reported separately; absolute timings depend on hardware and other workloads.

## Implementation

- Poster grids virtualize rows with two rows of overscan on each side, retain the focused card while scrolling, and expose logical list positions to accessibility tools. Stable row geometry reserves two title lines and one caption line. Resize and text-size changes recompute geometry. Scroll anchoring is disabled for the grid and its pagination sentinel to avoid automatically following newly appended pages.
- Title lists keep immutable page results in shallow refs. GETs support AbortSignal; replaced searches and disposed views abort requests and discard late responses. Event refreshes coalesce over 100 ms with one trailing refresh when changes arrive during a load. Navigation snapshots are bounded to eight route keys.
- The backend keeps at most 128 title pages, using SQLite total_changes and data_version plus the UTC date for invalidation. Reads inside transactions bypass the cache; responses are cloned so callers cannot mutate cached data. Tests cover local/external edits and rollbacks.
- Log history runs in a lazy dedicated worker, preserving existing cursor encoding and filtering. Worker failures reject pending reads; the next read starts a new worker. Shutdown terminates the worker. Live UI log updates batch over 50 ms, and filter changes cancel obsolete reads.
- Suggestion artwork uses four concurrent tasks through the existing provider limiter, retaining response order and offline fallbacks. Artwork downloads and suggestion reads share pending work. LRU caches keep at most 128 suggestion pages and 256 detail entries, with one-hour expiry. Download status loads are shared across mounting components and do not overwrite newer pushes.
- Download-tool polling stops while hidden and refreshes on return. Texture loads are deduplicated; replaced sources release their textures after materials refresh, and late results after replacement/teardown are disposed.
- Series data is grouped by season once. Rename previews share directory listings only within one preview, so a later preview or apply sees fresh filesystem state. Runtime backups copy SQLite pages asynchronously, and restore staging validates/snapshots in a worker; pending operations finish before the database closes.
- Packaging includes `background-worker.cjs` beside `server.cjs`. No REST response, WebSocket event or database schema changes are required.

## Verification

```powershell
yarn typecheck
yarn lint
yarn test
yarn build
yarn perf
yarn workspace @theama/desktop exec playwright test
```

The focused renderer check is `yarn workspace @theama/desktop exec playwright test performance.spec.ts` after building. Unit tests cover aborted pagination and late failures, burst refreshes and trailing work, worker cursor parity/shutdown, cache expiry/eviction/failures, texture ownership, hidden polling, shared download reads, standalone backups and staging from a live WAL database.

Final validation on the current workspace passed 776 unit/integration tests, type checking, linting and the production build. The Electron suite exercised 69 scenarios; eight initial failures were corrected and passed focused reruns, alongside the renderer performance test. The staged server also passed a smoke test using its bundled Node, native SQLite and worker for log reads, backup creation, restore staging and cancellation.

Live providers, slow network drives, real artwork decoding, FFprobe load and GPU-specific frame rates need representative hardware runs. The synthetic checks do not establish a general absence of memory leaks.
