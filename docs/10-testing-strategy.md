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
- `ui`: en/el **key parity**, identical placeholders/plural forms, no empty strings, Greek actually Greek, and a **source scan proving every `t('…')` key used exists**.

**End-to-end (Electron)** — 11 tests, including **add a Greek-named folder through the real picker flow → online → change type → duplicate rejected → remove, files untouched**, and a regression check that every section shows its "Add a folder" button. The run uses its own Chromium profile and answers the native folder dialog via a development-only hook (`THEAMA_TEST_PICK_FOLDER`, ignored in packaged builds): launch + connect; renderer sandbox (`require`/`process` undefined, only `window.theama`); every section's empty state; `/` opens search; Service page shows the running backend and history; Log history lists and filters; **stop → recovery screen → start → recovered**; **switch to Greek without restart and survive reload**; dark/light toggle; narrow viewport shows bottom navigation.

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

## 5. Manual Windows checklist (NSSM)
1. `yarn build`, `yarn nssm:fetch`, then `yarn service:install` (choose account) — UAC prompt appears; password prompt for "current user".
2. `sc query Theama` → RUNNING; the app shows *Running*, host *Windows service (NSSM)*, the chosen account.
3. From the app: Stop, Start, Restart — **no UAC prompt**; history shows `stop`/`start`.
4. Kill `node.exe` for the service in Task Manager → NSSM restarts it within ~5 s; history shows a `crash`.
5. Close the app: the service keeps running; reopen: reconnects.
6. Reboot: service starts automatically (delayed).
7. `yarn service:uninstall`: service removed, `%ProgramData%\Theama` left intact.
