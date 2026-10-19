# 04 · Local API

Base: `http://127.0.0.1:<port>/api/v1` (default port 47890, falls back to a free port; the real port is in `runtime.json`). Every schema below lives in `packages/contracts` and is shared by server, UI and desktop shell; the UI parses every response with its Zod schema.

## Conventions
- **Auth**: `Authorization: Bearer <token>` on every REST call and on the WebSocket upgrade. In the desktop app the main process adds it; the renderer never holds it.
- **Request hygiene**: Host must be loopback; Origin (if present) must be allowlisted; bodies ≤ 64 KB.
- **Errors**: `{ "error": { "code": string, "message": string, "details"?: unknown } }` — codes: `unauthorized` (401), `forbidden_host` / `forbidden_origin` (403), `invalid_request` (400, `details` = Zod issues), `not_found` (404), `internal_error` (500, no internals leaked).
- **Pagination**: cursor-based (`limit` ≤ 500, opaque `cursor`, response `nextCursor | null`).
- **Versioning**: path prefix; additive changes only within `v1`.

## Built endpoints

| Method | Path | Response | Notes |
|---|---|---|---|
| GET | `/health` | `{ status: "ok", time }` | Needs the token too — the API does not advertise itself. |
| GET | `/system/info` | `SystemInfo` — version, node version, pid, startedAt, uptime, `hostMode` (`service`/`foreground`), data/db/cache/log paths, schema version | |
| GET | `/settings` | `AppSettings` `{ language: en\|el, theme: system\|dark\|light, logRetentionDays }` | Missing/invalid values come back as defaults. |
| PUT | `/settings` | `AppSettings` | Body is a **partial** (`AppSettingsPatch`); unknown/invalid → 400. Broadcasts `settings.changed`. |
| GET | `/logs` | `LogPage { items: LogEntry[], nextCursor }` | Query: `level` (minimum), `source` (`app` \| `service-stdout` \| `service-stderr`), `from`, `to` (ISO), `q` (substring), `limit`, `cursor`. App log is paged newest-first across rotated files. Service output sources return the file tail (no pagination) with the file's mtime as the timestamp. |
| GET | `/library/sources` | `{ items: LibrarySource[] }` | Re-checks every folder's availability first (each check bounded to 3 s so a dead share can't stall it). `availability` is `online` / `offline` (unreachable, or a *different volume* mounted at the same path) / `unknown`. |
| POST | `/library/sources` | `LibrarySource` (201) | Body `{ path, libraryType?: movies\|series\|videos\|auto, recursive? }`. Validates: full path, no `..`, exists, is a directory, readable **by the service account**; records the volume serial. Errors: `invalid_path`, `not_found`, `not_a_directory`, `permission_denied`, `unreachable` (400), `source_exists` (409, case-insensitive). |
| PATCH | `/library/sources/:id` | `LibrarySource` | Partial `{ libraryType, recursive, enabled }`. |
| DELETE | `/library/sources/:id` | `{ deleted: true }` | Removes the folder from Theama only; **never touches files on disk**. |
| POST | `/library/sources/:id/scan` | `ScanJob` (202) | Queues a scan (or returns the one already waiting). Also started automatically when a folder is added, re-enabled or its type changes. |
| GET | `/scans?limit=` | `{ items: ScanJob[] }` | Newest first. `summary` = found/new/changed/moved/missing/skipped/probed/errors; `diagnostics` = human-readable notes. |
| GET | `/scans/:id` · POST `/scans/:id/cancel` | `ScanJob` · `{ cancelled }` | |
| GET | `/library/files` | `MediaFilePage { items, nextCursor, total }` | Query: `kind` (`movie`/`episode`/`video`/`extra`; extras are hidden unless asked for), `sourceId`, `q` (title, episode title or path), `hideUnavailable`, `limit` ≤ 500, `cursor` (keyset on title, season, episode, id). Each file carries `state`: `available`, `source_offline` (its folder is unreachable — kept, not deleted) or `missing_unconfirmed`. |
| GET | `/library/titles` | `TitlePage { items, nextCursor, total }` | One entry per **movie**, per **series** (all its episodes) and per personal video. Query: `kind` (`movie`/`series`/`video`; omitted = all except extras), `q` (full-text), `sort` (`title`/`added`/`year`), `hideUnavailable`, `limit` ≤ 200, `cursor`. Items carry file/episode/season counts and `availableCount` (0 = everything offline). |
| GET | `/library/title?key=` | `TitleDetail { summary, files[] }` | A title with every file, episodes ordered by season then episode. 404 `not_found` if the key is gone. |
| GET | `/library/status` | `{ ffprobeAvailable, fileCount, scanning }` | |
| GET | `/service/events` | `{ items: ServiceEvent[] }` (latest 100) | `start`, `stop`, `crash`, `restart`, `migrate` with reason, pid, version. |
| WS | `/events` | server → client `ServerEvent` | See below. |

### WebSocket `/api/v1/events`
| `type` | Payload | When |
|---|---|---|
| `hello` | `{ version, time }` | On connect |
| `heartbeat` | `{ time }` | Every 5 s. A client treats 12.5 s of silence as a dead socket and reconnects. |
| `settings.changed` | `{ settings }` | After `PUT /settings` (keeps multiple windows in sync) |
| `log.appended` | `{ entry }` | Every log line (live tail) |
| `library.changed` | — | A folder was added, changed or removed, or a scan finished |
| `scan.started` / `scan.finished` | `{ job }` | |
| `scan.progress` | `{ progress: { jobId, sourceId, phase: walking\|probing\|finalizing, found, toProbe, probed } }` | Throttled to ~2.5 per second |

## Desktop IPC (renderer ⇄ main) — `window.theama`
Defined in `packages/contracts/src/ipc.ts`; each channel has a Zod request schema, validated in the main process, and calls from frames other than Theama's own UI are rejected.

`appInfo` · `setLanguage` · `pickFolder` · `openPath` · `showItemInFolder` · `service.{status,start,stop,restart,install,uninstall,repair,onStatus}` · `logs.{readLocal,openFolder}` · `onNavigate`.

`logs.readLocal` exists so the recovery screen can show recent lines when there is no API to ask.

## Designed endpoints (not built yet)
| Group | Endpoints | Phase |
|---|---|---|
| Scans | `GET /scans`, `GET /scans/:id`, `POST /scans/:id/cancel` | 2 |
| Titles | `GET /movies`, `GET /series`, `GET /videos` (filters: genre, year, rating, watched, resolution, language, tags, collection, `availability`), `GET /movies/:id`, `GET /series/:id/seasons`, `GET /episodes/:id` | 2–5 |
| Search | `GET /search?q=` (grouped by category) + `GET /search/suggest` | 3 |
| Metadata | `POST /metadata/match` (candidates), `PUT /titles/:id/match` (select + lock), `POST /metadata/refresh` | 4 |
| Collections | `GET/POST /collections`, membership endpoints, ordering (`release` / `story` / `custom`) | 5 |
| Playback | `PUT /playback/:fileId` (progress, watched), `GET /players`, `PUT /players`, `POST /players/validate` | 6 |
| Files | `POST /files/rename/preview`, `POST /files/rename/apply`, `GET /files/operations`, `POST /files/operations/:id/rollback` | 6 |
| Subtitles | `GET /subtitles/:fileId`, `PUT /subtitles/associate` | 6 |

Anything that launches a process or opens Explorer is **not** an API endpoint: it goes through the desktop shell, because the service may live in another Windows session and because it keeps the "arbitrary website can trigger it" attack surface at zero.
