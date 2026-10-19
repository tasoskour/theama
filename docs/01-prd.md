# 01 · Product Requirements — Theama (Θέαμα)

> Status legend used across the docs: **Built** = exists and is tested in this repository today · **Designed** = specified here, not yet built.

## 1. Vision

Theama turns ordinary folders of movies, series and personal videos into a private, cinematic library: posters, backdrops, cast, seasons and episodes instead of filenames. It is local-first (no account, no cloud), works offline once metadata is cached, and never changes a user's files without explicit approval.

**Philosophy** (from the brief, kept as design constraints): navigation is the primary experience · local files are the source of truth · metadata enriches but never replaces ownership · the user controls file changes · everything works offline after caching · the user rarely needs to understand folder structure · no accounts · one person can install and use it with minimal setup.

## 2. Users

| Persona | Needs |
|---|---|
| **Personal archivist** (primary) | Thousands of files across several drives, some of them external and often unplugged. Wants them organised, searchable and watchable without babysitting. |
| **Greek / bilingual viewer** | UI and metadata in Greek where available, English fallback, Greek filenames and subtitles handled correctly. |
| **Keyboard-driven viewer** | Whole app usable without a mouse; predictable focus and scroll restoration. |

Single-user, single-machine. A secured LAN/mobile mode is explicitly future work.

## 3. Scope

### MVP (the "Definition of Success", brief §26)
| Area | Capability | Status |
|---|---|---|
| Shell | Desktop app (Electron), dark/light themes, EN/ΕΛ switching without restart, responsive layouts, bottom navigation on narrow windows | **Built** (shell, themes, i18n, responsive) |
| Backend | Local API + WebSocket, SQLite with migrations, runs as a Windows service **managed through NSSM** | **Built** (service install path unverified on a real UAC session, see risks) |
| **Service management** | Status, start, stop, restart, install, repair, uninstall from the app (menu + Settings → Advanced → Service) and a start/stop/crash history | **Built** |
| **Log history** | Searchable, filterable, paged history with live tail; readable even when the service is down | **Built** |
| Branding | Logo, app icon (`.ico`), tray/monochrome variants, favicon | **Built** |
| Library sources | Add/remove folders, type per folder, subfolders, enable/pause, online/offline status | **Built** (folder management) |
| Library scanning | Recursive scan, exclusions, filesystem watching | Designed (Phase 2) |
| **Absent media** | Offline drives/files are kept, shown dimmed with the reason, unplayable, and reconcile when the drive returns | Designed (model in 03/08; columns exist in `library_source`) |
| Discovery | Incremental scanning, FFprobe technical info, rename/move detection | Designed (Phase 2) |
| Browsing | Posters, rails, details pages, search (FTS5), filters, continue watching | Designed (Phases 3, 5) |
| Metadata | TMDB adapter, matching with confidence + manual correction + locking, artwork cache, Greek preferred | Designed (Phase 4) |
| Series | Seasons/episodes, multi-episode files, missing-episode detection | Designed (Phase 5) |
| Collections | Official collections, sequels, universes, user collections, never-fabricated orders | Designed (Phase 5) |
| Playback | External players (VLC, MPC-HC/BE, mpv, PotPlayer, default), open folder, copy path, watched state | Designed (Phase 6) |
| Subtitles | Embedded/external detection, language, association, default selection | Designed (Phase 6) |
| File organisation | Rename templates, preview, collision detection, journal, rollback | Designed (Phase 6) |
| Packaging | Installer, updates, backup/restore | Designed (Phase 7) |

### Post-MVP
Embedded player (codec/container limits must be evaluated first) · player-specific resume-position integrations · NFO import/export · smart collections beyond the basics · metadata refresh scheduling · additional providers via adapters.

### Optional / future
Secured LAN/mobile access (separate, explicitly enabled feature with its own security model) · subtitle provider adapters · additional languages.

### Non-goals
Accounts, cloud sync, analytics, scraping IMDb, bypassing provider terms, fabricating metadata or chronology, automatic renaming without approval, Docker/Redis/external databases.

## 4. UX priorities (ordered)
1. **Navigation quality** — keyboard, mouse and touch behave consistently; focus and scroll survive navigation.
2. **Truthfulness** — every title shown is local unless clearly labelled contextual; missing/offline is shown honestly, never hidden or faked.
3. **Calm density** — poster-led, editorial, few animations, reduced-motion respected.
4. **Recoverability** — every failure (service down, drive gone, API offline) has a visible explanation and a next action.

## 5. Functional requirements added to the brief

### FR-S: Service management (NSSM)
- FR-S1 The backend is a Windows service registered through NSSM; it keeps running when the UI closes.
- FR-S2 The UI can show service state (not installed / stopped / starting / running / stopping), process id, account and API reachability.
- FR-S3 Start, stop, restart need **no elevation** after installation (the installer grants the installing user those rights on the service).
- FR-S4 Install, repair, uninstall need one UAC prompt. The account is chosen at install: the user's own account (default, password asked once) or Local System.
- FR-S5 A native **Service menu** and Settings → Advanced → Service expose the same actions; destructive ones (uninstall) ask for confirmation.
- FR-S6 A start/stop/crash/migration history is recorded by the service itself and shown in the UI. An unclean shutdown is recorded as a crash on next start.
- FR-S7 When the service is unreachable the UI shows a recovery screen: cause, Start/Install/Retry, and the most recent log lines read **directly from disk**.
- FR-S8 In development the same UI runs against a plain Node process through the same controller interface; no service install required.

### FR-L: Log history
- FR-L1 Structured NDJSON logs rotated daily and at 10 MB, retention configurable (default 14 days).
- FR-L2 UI list is virtualised, newest first, cursor-paged, with level / source / time-range / text filters and entry detail.
- FR-L3 Live tail over WebSocket (paused while a time window is applied).
- FR-L4 Service stdout/stderr (NSSM-captured, rotated) are viewable as separate sources so crash traces are not lost.
- FR-L5 Export (copy) and open-folder actions.

### FR-A: Absent media
- FR-A1 Never delete records, metadata, overrides or watch progress because files are unavailable.
- FR-A2 Distinguish **source offline** (drive/share unreachable or a different volume under the same letter) from **file missing** (source online, file gone) from **removed** (user-confirmed or grace-period-expired).
- FR-A3 Offline titles stay browsable: dimmed poster, badge with the reason ("Offline — drive E: disconnected"), Play disabled with explanation.
- FR-A4 Filters "hide unavailable" / "only unavailable"; per-source status in Settings → Library.
- FR-A5 On reconnection the source rescans incrementally and the user is told.
- FR-A6 A title with several file versions plays whichever copy is available.

### FR-B: Branding
Logo mark, wordmark lock-up, app icon, monochrome tray icon, favicon; light and dark usage (see 06).

## 6. Acceptance for this document's scope
Phase 1 acceptance (brief §23): the app opens as a desktop application, communicates with the backend, and shows a functional shell — verified by the Electron end-to-end suite described in 10.
