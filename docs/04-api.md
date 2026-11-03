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
| GET | `/settings` | `AppSettings` `{ language: en\|el, theme: system\|dark\|light, visualMode: standard\|immersive, graphicsQuality: low\|medium\|high, backdropScene: auto\|classic\|movie\|series\|video\|action\|animation\|comedy\|crime\|documentary\|drama\|family\|fantasy\|horror\|romance\|scifi\|history\|western (default classic), backdropByGenre: boolean, backdropByKind: boolean, logRetentionDays, metadataLanguage: en\|el, subtitleLanguages: string[] (ISO 639-1, ≤ 6), renameMovieTemplate, renameEpisodeTemplate, logDetail: error\|warn\|info\|debug }` (`logDetail` takes effect at once; `THEAMA_LOG_LEVEL` in the environment overrides it) | Missing/invalid values come back as defaults. |
| PUT | `/settings` | `AppSettings` | Body is a **partial** (`AppSettingsPatch`); unknown/invalid → 400. Broadcasts `settings.changed`. |
| GET | `/logs` | `LogPage { items: LogEntry[], nextCursor }` | Query: `level` (minimum), `source` (`app` \| `service-stdout` \| `service-stderr`), `from`, `to` (ISO), `q` (substring), `limit`, `cursor`. App log is paged newest-first across rotated files. Service output sources return the file tail (no pagination) with the file's mtime as the timestamp. |
| GET | `/library/sources` | `{ items: LibrarySource[] }` | Re-checks every folder's availability first (each check bounded to 3 s so a dead share can't stall it). `availability` is `online` / `offline` (unreachable, or a *different volume* mounted at the same path) / `unknown`. |
| POST | `/library/sources` | `LibrarySource` (201) | Body `{ path, libraryType?: movies\|series\|videos\|auto, recursive? }`. Validates: full path, no `..`, exists, is a directory, readable **by the service account**; records the volume serial. Errors: `invalid_path`, `not_found`, `not_a_directory`, `permission_denied`, `unreachable` (400), `source_exists` (409, case-insensitive). |
| PATCH | `/library/sources/:id` | `LibrarySource` | Partial `{ libraryType, recursive, enabled }`. |
| POST | `/library/sources/:id/relocate` | `LibrarySource` | Body `{ path }`. Re-roots the folder's stored paths (files, exclusions, path-derived title keys) to the new location and records its volume serial, then rescans. Errors: `same_path`, `invalid_path` (overlaps the old location), `not_found`, `not_a_directory`, `permission_denied` (400), `source_exists` (409). A drive that returns under another letter is relinked automatically by the availability poll. |
| DELETE | `/library/sources/:id` | `{ deleted: true }` | Removes the folder from Theama only; **never touches files on disk**. |
| POST | `/library/sources/:id/scan` | `ScanJob` (202) | Queues a scan (or returns the one already waiting). Also started automatically when a folder is added, re-enabled or its type changes. |
| GET | `/scans?limit=` | `{ items: ScanJob[] }` | Newest first. `summary` = found/new/changed/moved/missing/skipped/probed/errors; `diagnostics` = human-readable notes. |
| GET | `/scans/:id` · POST `/scans/:id/cancel` | `ScanJob` · `{ cancelled }` | |
| GET | `/library/files` | `MediaFilePage { items, nextCursor, total }` | Query: `kind` (`movie`/`episode`/`video`/`extra`; extras are hidden unless asked for), `sourceId`, `q` (title, episode title or path), `hideUnavailable`, `limit` ≤ 500, `cursor` (keyset on title, season, episode, id). Each file carries `state`: `available`, `source_offline` (its folder is unreachable — kept, not deleted) or `missing_unconfirmed`. |
| GET | `/library/titles` | `TitlePage { items, nextCursor, total }` | One entry per **movie**, per **series** (all its episodes) and per personal video. Query: `kind` (`movie`/`series`/`video`; omitted = all except extras), `q` (full-text), `sort` (`title`/`added`/`year`), `hideUnavailable`, `limit` ≤ 200, `cursor`. Items carry file/episode/season counts and `availableCount` (0 = everything offline). |
| GET | `/library/title?key=` | `TitleDetail { summary, files[] }` | A title with every file, episodes ordered by season then episode. 404 `not_found` if the key is gone. |
| GET | `/collections?kind=official\|user&q=` | `{ items: CollectionSummary[] }` | Official sets appear only while something in them is in the library. `CollectionSummary { id, kind, name, overview, memberCount, localCount, posterUrl, previewPosters }`. |
| GET | `/collections/:id?order=release\|custom` | `CollectionDetail { summary, backdropUrl, orders, order, members[] }` | A member is `{ position, key, titleKey, title, year, releaseDate, overview, posterUrl, summary }`; `summary` (a library card) and `key` are null for a **contextual** entry the library does not have. Official sets offer `release` only; an unavailable `order` falls back to the first offered. |
| POST | `/collections` | `CollectionDetail` (201) | `{ name, key? }` — a new user collection, optionally starting with a title. `409 duplicate_name` (case-insensitive), `404 unknown_title`. |
| PATCH / DELETE | `/collections/:id` | `CollectionDetail` / `{ deleted }` | User collections only (`403 not_editable` for official). Delete removes memberships, never titles. |
| POST / DELETE | `/collections/:id/members` | `CollectionDetail` | `{ key }` body to add (idempotent) / `?key=` to remove. |
| PUT | `/collections/:id/order` | `CollectionDetail` | `{ keys }` — the custom order; unnamed members follow in their old order; a stranger or a repeated key is `400 bad_order` and nothing changes. |
| PUT | `/playback/files/:id` | `{ changed }` | `{ watched }` — mark one file watched or not. |
| PUT | `/playback/titles` | `{ changed }` | `{ key, watched, season? }` — a whole title or one season (0 = specials). `404` for an unknown title. |
| GET | `/playback/continue?limit=` | `{ items: ContinueItem[] }` | `{ summary, fileId, label ("S02E03" or null), resumeSeconds, lastActivityAt }`. |
| GET | `/playback/files/:id/launch` | `LaunchInfo { path, fileName, title, kind, subtitle, subtitleLanguages, resumeSeconds }` | What the **desktop shell** needs to start a player. `409 unavailable` if the drive is offline or the file moved. The subtitle is the first external file matching the language preferences (forced-only never). |
| POST | `/playback/files/:id/launched` | `{ ok }` | Recorded by the shell after a player started. Does not mark anything watched. |
| PUT | `/playback/files/:id/progress` | `{ outcome: ignored \| saved \| watched, nextUp? }` | `{ positionSeconds, durationSeconds, final }`, forwarded by the shell while VLC, mpv or MPC-HC/BE is open. From 90 % the file becomes `watched`, including short episodes; unfinished playback under 5 minutes is `ignored`; otherwise the whole-second resume position is `saved`. Completion checks preserve subsecond input precision. A qualifying final report includes `nextUp: { next, title, countdownSeconds }` when autoplay is enabled and another local episode is available. `library.changed` is broadcast when the file turns watched or a final report saves progress. |
| GET | `/library/files/:id/subtitles` | `FileSubtitles { embedded, external[], chosen, preferred }` | External files beside the video (and in `Subs`/`Subtitles`), with language, forced and SDH flags. |
| GET | `/subtitles/providers` | `SubtitleProviders` | Configuration/account flags for OpenSubtitles and SubDL; never credentials. |
| PUT | `/subtitles/providers/:provider/credentials` | `SubtitleProviders` | `{ apiKey: string \| null }`; validates before replacing a working key. Credentials stay in `secrets/subtitles.json`, outside database backups. |
| POST | `/subtitles/providers/:provider/test` | `SubtitleProviders` | Checks the configured provider. |
| POST / DELETE | `/subtitles/opensubtitles/login` | `SubtitleProviders` | POST `{ username, password }` validates and remembers login for automatic session renewal. DELETE removes the login but retains the API key. |
| POST | `/library/files/:id/subtitles/search` | `SubtitleSearchResults` | `{ provider, languages, title }` (`languages`: 1–6 ISO 639-1 codes, most wanted first; one provider request, results grouped by language); derives identifiers/episode/path from the library. Within each language, OpenSubtitles hash matches rank first, then release similarity. Season packs are excluded from SubDL searches. |
| POST | `/library/files/:id/subtitles/download` | `SubtitleDownloadResult` | `{ resultId, entryId? }`; references expire after 20 minutes and are bound to the file/path. Returns `{ state: "select", files }` for multi-file archives, or `{ state: "saved", fileName }`. Never accepts a destination or URL. Existing files are preserved. |
| POST | `/files/rename/preview` | `RenamePreview { items[], counts }` | `{ keys, movieTemplate?, episodeTemplate? }`. Nothing is touched. Item statuses: `ok`, `unchanged`, `collision_exists`, `collision_batch`, `too_long`, `unavailable`, `missing`, `skipped`. `400 invalid_template`, `400 not_renamable` (personal videos), `404`. |
| POST | `/files/rename/apply` | `{ batch, changed }` | The same request plus `approved: [{from, to}]`. The plan is rebuilt and only approved pairs that **still match it exactly** are renamed; the rest count in `changed`. Each rename is journalled first. |
| GET | `/files/operations?limit=` / `/files/operations/:id` | `OperationList` / `OperationBatch` | The journal, newest first. |
| POST | `/files/operations/:id/rollback` | `OperationBatch` | Puts renamed files back, as far as that is safe; an item whose file changed since is reported as `rollback_failed`, never forced. Idempotent. |
| GET | `/backups` | `BackupList { items[], pending, directory }` | Newest first. `pending` is a staged restore waiting for the service to restart. |
| POST | `/backups` | `BackupInfo` (201) | A manual backup, written to the backups folder (the API never writes anywhere else). |
| DELETE | `/backups/:name` | `{ deleted }` | Only names in the list; anything else is `404`. |
| POST | `/backups/restore` | `BackupList` | `{ name }` (a listed backup) or `{ path }` (a file picked with the native dialog). Checks it and stages it; `422 invalid_backup` / `422 newer_version`, `400` for a relative path. **Nothing changes until the service restarts.** |
| DELETE | `/backups/restore` | `BackupList` | Cancels a staged restore. |
| POST | `/diagnostics/client-error` | `{ accepted }` | The interface reports a caught error; written to the log history (at most 30 a minute). |
| GET | `/diagnostics/report` | text | Versions, state, counts, service history, recent warnings and errors. Contains paths, never the API token or TMDB key. Nothing is sent anywhere. |
| GET | `/metadata/status` | `MetadataStatus { configured, state no_key\|idle\|working\|unavailable\|invalid_key, pending, matched, ambiguous, unmatched, current, message }` | Also pushed over the WebSocket as `metadata.status`. |
| PUT | `/metadata/credentials` | `MetadataStatus` | Body `{ tmdbApiKey: string \| null }` (`null` removes it). A v3 API key or a v4 read-access token. The key is checked with TMDB first: rejected → `400 invalid_key` and the previous key is kept; TMDB unreachable → saved anyway and the state says so. **The key is never returned, logged or stored in the database.** |
| POST | `/metadata/retry` | `MetadataStatus` | Clears a "paused after failures" state and looks again now. |
| GET | `/metadata/suggestions?section=&year=&page=` | `{ items: Suggestion[], hasMore }` | For the *Downloads* page: one page (up to 20) of movies and series together, alternating, each with a `rating` (0–10 or null) and a cached thumbnail. `section=new` is the popular releases of the last 60 days; `section=year` needs `year` and gives that year's most popular titles. Remembered for an hour. Same errors as `/metadata/search`. |
| GET | `/metadata/suggestions/details?kind=&externalId=` | `{ imdbId, trailer }` | The IMDb id and official YouTube trailer of one suggestion (either may be `null`), fetched when the user asks for them. Same errors as `/metadata/search`. |
| GET | `/metadata/awards?subject=&externalId=` | `AwardsResult { wins, nominations, items: { name, result won\|nominated, year, forWork }[] }` | Awards and nominations of a movie, a series or a person (`subject=movie\|series\|person`, `externalId` is the TMDB id), looked up on Wikidata by TMDB id — no key needed, and nothing is stored: answers are remembered for a day. Wins come first, then nominations, newest first (up to 200 items; the counts are complete). Names follow the metadata language when Wikidata has them. `503 provider_unavailable` when Wikidata does not answer; set `THEAMA_WIKIDATA_ENDPOINT` to point somewhere else. |
| GET | `/metadata/search?kind=&q=&year=` | `{ items: MatchCandidate[] }` | For the *Identify* dialog: ranked results with cached thumbnails. `409 no_key`, `400 invalid_key`, `503 provider_unavailable`. |
| GET | `/downloads/status` | `DownloadClientStatus { state, url, username, version, webApiVersion, message }` | qBittorrent connection. `state`: `not_configured\|connected\|unreachable\|auth_failed\|forbidden`. The password is never returned. |
| PUT | `/downloads/client` | `DownloadClientStatus` | Body `{ qbittorrent: { url, username, password } \| null }`. Tested first: rejected login → `400 invalid_credentials` and nothing is stored; banned → `403 client_forbidden`; not running → saved, state `unreachable`. |
| GET / PUT | `/downloads/indexer` | `IndexerStatus { state, url, version, message }` | Prowlarr connection; body `{ prowlarr: { url, apiKey } \| null }`. Same rules. |
| GET | `/downloads/releases?kind=&title=&year=&season=&episode=&sort=&collectionName=` | `ReleaseList { source: prowlarr, items: Release[] }` | Searches Prowlarr only, filters to the title, and ranks by quality (default) or seeders (`sort=seeders`). Movie `collectionName` hints at a collection-pack search; results may have `collectionPack: true`, meaning the torrent name suggests a collection but files are unverified. Releases carry an opaque `id`, never a link. `source=qbittorrent` returns `400 invalid_request`; missing Prowlarr returns `409 not_configured`. |
| POST | `/downloads` | `201 { ok: true }` | Body `{ releaseId, kind }`. Only ids from a recent `/downloads/releases` are accepted (`410 release_expired` otherwise). Adds to qBittorrent tagged `theama`, into the library folder chosen for that kind. |
| GET | `/downloads` | `DownloadList { reachable, items: DownloadItem[] }` | Only downloads Theama added, or every torrent when the setting `downloadsShowAll` is on (`own` tells them apart). Also pushed as `downloads.changed`. |
| POST | `/downloads/:hash/pause` · `/resume` | `{ ok: true }` | `404` for a hash that is not one of ours (any torrent qBittorrent has, when `downloadsShowAll` is on). |
| GET | `/downloads/:hash/files` | `DownloadFileList { files: { index, name, size, progress, wanted }[] }` | Empty while qBittorrent is still fetching a magnet link's details (state `metadata`). Same `404` rule. |
| PUT | `/downloads/:hash/files` | `{ ok: true }` | Body `{ wanted: number[] }`: exactly these files are downloaded, the rest skipped. `400 invalid_selection` for an index not in the torrent or an empty list, `409 files_not_ready` before the file list exists. |
| DELETE | `/downloads/:hash?deleteFiles=` | `{ ok: true }` | Removes from qBittorrent; `deleteFiles=true` also deletes the data. |
| POST | `/library/title/identify` | `TitleDetail` | Body `{ key, kind, externalId }`. The user's choice: fetched, stored and **locked**. `400 wrong_kind` if the title is not that kind (or is a personal video), `404` for an unknown title or provider id. |
| POST | `/library/title/refresh` | `TitleDetail` | Body `{ key }`. Re-fetches the current match; does not change it. |
| POST | `/library/title/clear-match` | `TitleDetail` | Body `{ key }`. Removes provider data and locks the title as unmatched. |
| POST | `/library/title/unlock` | `TitleDetail` | Body `{ key }`. Lets automatic matching reconsider (an unmatched/ambiguous title is looked up again at once). |
| GET | `/artwork/:file` | image | Cached artwork. Same token rule as everything else; file names are validated (`poster-abc.jpg`), anything else is 400/404. |
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

`appInfo` · `setLanguage` · `setWindowTheme` · `pickFolder` · `pickBackupFile` · `desktop.{get,set}` · `openPath` · `showItemInFolder` · `service.{status,start,stop,restart,install,uninstall,repair,onStatus}` · `logs.{readLocal,openFolder}` · `players.{list,setDefault,addCustom,remove,play}`.

`logs.readLocal` exists so the recovery screen can show recent lines when there is no API to ask.

`downloadTools.status()` returns `{ vpn: { state, reason, checkedAt }, tools }`. VPN states are `connected`, `disconnected`, `unknown`, and `unsupported`; `checkedAt` is Unix time in milliseconds. Each tool reports installation availability and a nullable process-running flag, independent of its Web UI. Windows checks NordLynx/NordVPN OpenVPN adapters, tunnel addresses and internet routes, then requires a successful HTTPS protection check at `api.nordvpn.com/v1/helpers/ips/insights`. Check failures never yield a verified connection. IP/location data from that response is neither returned nor logged.

`downloadTools.open(tool)` accepts only `nordvpn`, `qbittorrent`, or `prowlarr`, and returns `{ ok, code }`. The desktop discovers executable paths and launches without a shell. Prowlarr opens its configured HTTP(S) address (or `http://localhost:9696`), after readiness for a local instance. Arbitrary executable paths and renderer-supplied URLs are not accepted.

Downloads and Downloads Settings refresh these checks every ten seconds while visible and on focus. Verification expires after 25 seconds; remote qBittorrent addresses are explicitly unverifiable from the local check. These are advisory checks: they do not alter downloads, VPN settings, or split tunneling.

## Designed endpoints (not built yet)
| Group | Endpoints | Phase |
|---|---|---|
| Scans | `GET /scans`, `GET /scans/:id`, `POST /scans/:id/cancel` | 2 |
| Titles | `GET /movies`, `GET /series`, `GET /videos` (filters: genre, year, rating, watched, resolution, language, tags, collection, `availability`), `GET /movies/:id`, `GET /series/:id/seasons`, `GET /episodes/:id` | 2–5 |
| Search | `GET /search?q=` (grouped by category) + `GET /search/suggest` | 3 |
| Collections | `GET/POST /collections`, membership endpoints, ordering (`release` / `story` / `custom`) | 5 |
| Playback | progress for PotPlayer and other players that expose no interface | later |
| Subtitles | `PUT /subtitles/associate` (pick a file by hand) | later |

As built, the desktop IPC (`window.theama.players`) is `list`, `setDefault`, `addCustom` (a native file picker), `remove` and `play({ fileId, playerId? })`; the UI never supplies a path, only a file id. Anything that launches a process or opens Explorer is **not** an API endpoint: it goes through the desktop shell, because the service may live in another Windows session and because it keeps the "arbitrary website can trigger it" attack surface at zero.
