# 10 · Testing strategy

Principle: test what can silently corrupt a user's library or lock them out — parsing, matching, filesystem operations, the security boundary, and the service lifecycle — and prove the whole stack works end to end in the real Electron shell.

## 1. Layers

| Layer | Tooling | What it covers |
|---|---|---|
| Unit | Vitest (projects per workspace, `yarn test`) | Pure logic: contracts, log reader/writer, path safety, sc.exe parsing, elevation command building, i18n parity |
| Integration | Vitest + real Fastify/SQLite/WebSocket on a temp dir | API contract, auth/Host/Origin rules, migrations, repositories, log paging, WebSocket push, service-event history |
| End-to-end | Playwright `_electron`, real server process via the dev controller (`yarn test:e2e`) | Launch, connect, navigation, sandboxing, service stop/start + recovery, log history, language and theme switching, mobile layout |
| Manual (Windows) | Checklist below | NSSM install/repair/uninstall (needs UAC), upgrade preserves data |

## 2. What exists today (Phase 1)

**Unit / integration (Vitest)**
- `contracts`: defaults, partial patches (guards the Zod default-leak bug), query coercion/limits, event parsing.
- `logs`: NDJSON mapping, junk-line tolerance, rotation by day and by size, restart continuation, retention pruning, **cursor paging across files without gaps/duplicates**, level/text/time filters, stale/corrupt cursors, NSSM output tails, merged "recent local" view.
- `server`: Host/Origin/token rules (incl. look-alike origins), token creation/reuse, **401 without token on REST and WebSocket**, DNS-rebinding rejection, CORS preflight allow/deny, error envelope, settings round-trip + validation, system info, `runtime.json` lifecycle, log paging/filters over HTTP, service-event history, WebSocket hello + live log push, migrations (idempotent, refuse newer DB, FK cascade), settings repo fallbacks, **crash detection**, **schema-drift guard** (Drizzle vs SQL).
- `desktop`: sc.exe output parsing incl. localized Windows (error 1060 by code), NSSM controller against a fake SCM (start/stop/restart idempotence, access-denied guidance, not-installed), elevation command builder (quote escaping, injection rejection, SID validation), IPC path safety (traversal, device paths, executables, Unicode), origin helper for custom schemes.
- `server` (library): path normalisation (Windows/UNC/Greek, rejects `..`/device paths), availability (offline on unreachable or different volume), add/duplicate/validation errors, patch, offline → online transition, remove leaves files untouched, auth.
- `server` (scanning): filename parser table built from **real release names** (Arcane, MacGruber, Mushishi, Re Zero, The Outsider, Severance, X-Men '97, …) plus the brief's examples and Greek names; FFprobe JSON parsing and a real child-process runner against a fake ffprobe (arguments, errors, timeout); the scanner on real temporary trees (first scan, skip unchanged, changed files, **rename by NTFS id**, moves, deletion → missing → restored, unreachable/offline-during-scan/cancelled scans change nothing, looping junction, nested folders, extras, folder-type change re-parses); the job manager (order, dedupe, cancel, crash recovery); the auto-scanner with fake watchers (debounce, back-online, drive pulled); the HTTP API end to end including offline listing.
- `server` (browsing): title keys (case, accents, punctuation, years), FTS query builder against hostile input, grouping into series/movies with counts, sorting (title/added/year) and cursor paging without gaps in all three orders, **Greek and Latin accent- and case-insensitive search**, index kept in sync on rename and cascade delete, index rebuild, hide-unavailable, title detail ordering.
- `server` (metadata): matcher (case/accent/word-order/typo tolerance, contained titles, year signal, clear winner, look-alikes → ambiguous, year-too-far → not auto, nonsense → unmatched); TMDB adapter against a **fake TMDB server** (`tools/fake-tmdb`) incl. v3 key vs v4 token, translated/original names, Greek field fallback, seasons; resilience (retry count, 429 + `Retry-After`, dropped connection, circuit breaker open/close/reset, rejected key not counted, close on shutdown, image size limit); the whole flow through the API (no key → nothing is sent, wrong key refused and not stored, key never in responses/settings/logs, automatic match/ambiguous/unmatched, personal videos never sent, artwork cached once and served with the token only, odd file names refused, provider-name search, manual identify + lock surviving a rescan, wrong-kind/unknown-id rejections, clear/unlock, metadata-language switch with per-field fallback, provider down → library still browsable → retry recovers).
- `server` (series & collections): coverage table tests (missing vs upcoming vs undated, today counts as aired, ranges, duplicates, strays and unnumbered files, absurd ranges, no provider data); the whole flow through the API against the fake TMDB (missing counts and per-season coverage, a multi-episode file closing a gap, unidentified series have none, official set with contextual entries in release order, local link appearing without a new provider request, official sets read-only, release-only ordering, hidden when nothing is local and back with the files; user collections: create/duplicate/blank name, add/idempotent add/unknown title, custom vs release order, rejected orders change nothing, partial order, rename, refs on the title page, kind filter, a member whose folder was removed stays as a non-playable entry, delete leaves titles alone); refresh rules (`stale`: language, data version, airing series after a week, collection not yet read, titles without files).
- `server` (playback, subtitles, renaming): next-episode rule tables; subtitle discovery on a fake directory tree (language tags, forced/SDH, `Subs` folders, case, unreadable folders) and the choice by preference; language table; FFprobe stream parsing (languages normalised, forced/default flags); the API end to end (watched on a file/season/title, rollups, continue-watching, a started film that is not finished, launch info with the right subtitle and with changed preferences, refusal for an offline drive); rename **template** tests (validation, padding, Windows-forbidden characters, empty brackets, reserved names); rename **service** tests on a fake disk (subtitle ownership between neighbouring titles, multi-episode names, case-only change, offline, too long, a failing rename skips its subtitle and the library stays in step, a file that appeared since the preview is not overwritten, crash recovery by looking at the disk, journal listing); and the real-file API flow (collisions of both kinds, the library follows, watched state survives, a rescan changes nothing, stale approvals ignored, undo, undo that refuses to force).
- `desktop`: player detection (Program Files, PATH), argument building for every player (spaces, `&`, `;`, quotes stay one argument; `--` for mpv), custom-program validation, default selection and fallback to the system player, the play flow (backend refusal, unsafe or missing paths, odd subtitle path dropped, launch failure, report only after a successful start).
- `ui`: poster artwork determinism, monograms, keyboard grid navigation (edges, short last row, paging), formatting helpers (sizes, durations, resolution, episode codes), en/el **key parity**, identical placeholders/plural forms, no empty strings, Greek actually Greek, and a **source scan proving every `t('…')` key used exists**.

**End-to-end (Electron)** — 11 tests, including **add a Greek-named folder through the real picker flow → automatic scan → the video is listed with its guessed title and year → rename it on disk and rescan (recognised as renamed) → unplug the folder (listed as Offline, dimmed, filterable, nothing lost) → open its details and return with Esc (focus restored to the card) → search it in Greek without accents → plug it back → change type → duplicate rejected → remove, files untouched**, and a regression check that every section shows its "Add a folder" button. The run uses its own Chromium profile and answers the native folder dialog via a development-only hook (`THEAMA_TEST_PICK_FOLDER`, ignored in packaged builds): launch + connect; renderer sandbox (`require`/`process` undefined, only `window.theama`); every section's empty state; `/` opens search; Service page shows the running backend and history; Log history lists and filters; **stop → recovery screen → start → recovered**; **switch to Greek without restart and survive reload**; dark/light toggle; narrow viewport shows bottom navigation.

## 3. Planned per phase
| Phase | Add |
|---|---|
| 2 | Filename parser table tests (the brief's examples + Greek/Unicode + multi-episode); scanner against a generated temp tree (moves, renames, exclusions, junctions/loops, overlapping sources); **offline-source simulation** (volume-id mismatch, unreachable root, recovery); scan resume after kill |
| 3 | Rail keyboard/focus model; search FTS (Greek accent folding); URL-state round trips; virtual list perf budget |
| 4 | Matcher scoring table with ambiguity/threshold cases; provider adapters against recorded fixtures (no live network in CI); rate-limit/backoff; match locking survives refresh |
| 5 | Episode mapping, missing/unaired classification, next-episode rules, collection ordering (never fabricated) |
| 6 | **Rename journal**: crash-injection between steps, rollback, collision, associated files, currently-playing guard; player argument building (spaces/Unicode/quotes in names) |
| 7 | Installer upgrade/uninstall on a clean VM; backup/restore round trip |

e2e additions across phases: first launch, add folder, scan progress, browse, details, seasons, missing episodes, search, rename preview/confirm, launch external player (stub executable) — each in **EN and ΕΛ**, **dark and light**, **desktop and mobile** viewports.

## 4. Performance budgets (measured from Phase 2/3)
Targets from the brief: 5,000 movies, 1,000 series, tens of thousands of episode files.
- Library list first page ≤ 150 ms server-side; search ≤ 100 ms p95 on the target size.
- Initial scan never blocks the UI; API p95 < 50 ms *during* a scan.
- Rail scroll at 60 fps with virtualised/lazy artwork; memory flat while scrolling.
- Startup to interactive shell ≤ 2 s with the service already running.
Benchmarks run against a generated synthetic library (a script creating N empty files with realistic names) so they are reproducible.

### Accessibility audit (`apps/desktop/e2e/a11y.spec.ts`)
Launches the app with a real library (films, a series with gaps, an unidentified series, a personal video, official and personal collections, fake TMDB data), then runs **axe-core** (WCAG 2.0/2.1 A and AA rules) on every page (Home, Movies, Series, My Videos, Search, Collections, nine Settings pages), on four kinds of title page and both collection pages, and on the dialogs (add folder, identify, rename, new collection) — in dark and light, English and Greek: four passes of about 30 s. It also checks that arrow keys walk collection cards and that a live theme switch repaints the sidebar. Notes on the method: axe is injected through the debugger (Electron cannot open the second page `@axe-core/playwright` wants, and the app's CSP forbids inline scripts); each pass starts from a freshly loaded page in its theme and waits until no page is mid-fade, because auditing a half-faded page sees two pages and washed-out colours; a contrast finding that axe makes against an assumed white background (it cannot read colours behind anything below the fold) is re-computed from the real background and dropped only if that passes. This cannot judge reading order, wording or focus management as a whole: that needs a person with a screen reader.

### Measured against the budgets (`yarn perf`)
A synthetic library of 4,800 identifiable titles / 20,000 files (3,800 films, 1,000 series of 16 episodes, 200 personal videos; most identified, with episode lists, watched marks and 40 collections), then a real scan of 10,000 empty files. Run on the development PC (Windows 10, Node 24):

| | p50 | p95 | budget |
|---|---|---|---|
| first page: A–Z / recently added / by year | 44 / 45 / 35 ms | 56 / 57 / 51 ms | 150 ms |
| series only · hide unavailable · deep scroll | 28 · 17 · 37 ms | 33 · 22 · 47 ms | 150 ms |
| search (prefix, mixed Latin/Greek) | 6 ms | 13 ms | 100 ms |
| title page (series with episodes · film) | 3.6 · 2.0 ms | 8 · 6 ms | 150 ms |
| continue watching · collections · technical file list | 14 · 12 · 25 ms | 27 · 22 · 30 ms | 150 ms |
| API while a 10,000-file scan runs | 10 ms | 15 ms | 50 ms |
| service start to listening | 426 ms | | 2,000 ms |
| scan of 10,000 files (no FFprobe) | 5.2 s | | |

The first run found two real problems (the missing-episode count and collections were quadratic); `apps/server/src/scan/titles-scale.test.ts` now fails if listing a ~5,000-file library takes more than 1.5 s, which those bugs missed by orders of magnitude. That first pass did not measure renderer memory/frame timing or FFprobe's effect on scan time. The [2026-10-25 performance follow-up](12-performance.md) adds a virtualized-grid renderer test and API responsiveness checks during large log searches. FFprobe and real-artwork workloads still need representative hardware runs.

### The packaged app (`yarn test:packaged`)
Builds the unpacked app and drives the shipped `Theama.exe` with Playwright: window and interface from `resources/ui`, the bundled Node running the bundled backend with its native SQLite module, FFprobe found, a Greek-named folder scanned, the service and backup pages, a backup then restore then service restart onto the restored library, and the notices present. It runs the backend as a plain child (`THEAMA_CONTROLLER=process`) because a Windows service needs an administrator's approval.

### Players in the end-to-end test
The Electron tests never start a real player: with `THEAMA_TEST_PLAYER_LOG` set (honoured in unpackaged builds only) the shell pretends the usual players are installed under a made-up Program Files folder and appends what it *would* have started to a log, which the test reads back.

### Metadata without a TMDB key
All automated metadata tests use `tools/fake-tmdb/server.mjs`, a small local server that speaks the TMDB shapes Theama uses (search, details with credits, seasons, images, 401/404/429/500 and dropped connections). To click through the app against it: `yarn tmdb:fake`, then start Theama with the two environment variables it prints and use the key it prints. The real service has been probed only for its error shape (HTTP 401 with `status_code` 7 for a missing key).

## 5b. Manual checks that automation cannot make
- **Screen reader pass** (NVDA or Narrator): open each page; headings and landmarks read in a sensible order; cards read as "title, detail"; dialogs trap focus and return it; the Play button, watched toggle and rename preview are usable without sight.
- **Tray** (installed app): enable *Keep Theama in the notification area*, close the window, find the icon near the clock (it may be in the hidden-icons flyout), click it, use *Quit*; sign out and in with *Start Theama when I sign in* on.

## 6. Manual checklist for the installer (not automated: needs an administrator's approval)
1. `yarn dist` (or `yarn dist:signed`, see below), copy `build/installer/Theama-Setup-<version>.exe` to a clean Windows 10/11 VM. Unsigned, SmartScreen warns: *More info → Run anyway*. Signed, check *Properties → Digital Signatures* shows your name and a timestamp.
2. Install (UAC). Start menu and desktop shortcuts exist; the app opens and offers to install the service; install it (account choice, UAC) and check *Running*.
3. Add a folder, let it scan, make a backup. Reboot: the service starts and the library is intact.
4. Install a **newer** build over it: the service is stopped, files replaced, the service started again, the library intact, a *Before an upgrade* backup exists if the database layout changed.
5. Uninstall: the service is gone; answering *No* to the data question keeps `%ProgramData%\Theama`; reinstalling finds the library; uninstalling again and answering *Yes* removes the folder. Video files are never touched.
6. `sc query Theama` after each step; `%ProgramData%\Theama\logs` has no unexpected errors.

## 5. Manual Windows checklist (NSSM)
1. `yarn build`, `yarn nssm:fetch`, then `yarn service:install` (choose account) — UAC prompt appears; password prompt for "current user".
2. `sc query Theama` → RUNNING; the app shows *Running*, host *Windows service (NSSM)*, the chosen account.
3. From the app: Stop, Start, Restart — **no UAC prompt**; history shows `stop`/`start`.
4. Kill `node.exe` for the service in Task Manager → NSSM restarts it within ~5 s; history shows a `crash`.
5. Close the app: the service keeps running; reopen: reconnects.
6. Reboot: service starts automatically (delayed).
7. `yarn service:uninstall`: service removed, `%ProgramData%\Theama` left intact.
