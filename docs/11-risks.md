# 11 · Risks and trade-offs

## Windows Service via NSSM
| Risk | Detail | Mitigation |
|---|---|---|
| **Not yet verified end to end** | The elevated install/repair/uninstall path (`service-admin.ps1`) needs a real UAC session and a Windows password prompt; it could not be exercised in the automated/CI-style session this was built in. The controller logic, parsing, command construction and escaping are unit-tested; NSSM itself was fetched and checksum-verified. | Run the manual checklist in 10 §5 before relying on it. Expect to adjust NSSM parameter details if something differs on your Windows build. |
| NSSM is unmaintained | Last stable release 2.24 (2014). Works on current Windows 10/11, but no fixes are coming; a few AV products flag it heuristically. | Pinned and SHA-256-verified download; all NSSM use is behind `ServiceController` and one PowerShell script, so replacing it (WinSW, or Node's own service wrapper) is a contained change. |
| Account choice | *Current user* keeps file permissions and UNC shares but needs the password (NSSM takes it on its command line, briefly visible to admins on the machine) and the service breaks if the password changes. *Local System* needs no password but renames then run with full system rights. | Chosen at install, default is the user's account; **Repair** re-runs the choice; the UI explains the trade-off. |
| Mapped drive letters | Services never see per-user mapped drives (`Z:`). | Document: use UNC paths (`\\NAS\share`) for network media. Local and USB drives are fine. |
| Session 0 isolation | A service cannot show UI or reliably launch interactive programs. | All interactive actions (players, Explorer, folder picker) live in the desktop shell, by design. |
| Non-elevated control | Start/stop without UAC depends on the service ACL set at install. | `status()` explains an access-denied and points to **Repair**; if the ACL is missing the user only loses the convenience, not the feature. |
| Graceful stop | NSSM stop → Ctrl+C → server shuts down. If Node ignores it the service is terminated (SQLite WAL makes this safe, and the next start logs a `crash`). | 20 s console grace; crash detection by unmatched `start`; WAL. |
| Elevation prompt UX | `Start-Process -Verb RunAs` shows the standard UAC dialog; if the user cancels, nothing is changed and the UI says so. | Result file protocol; no partial state is left behind except what `repair` will fix. |

## Player integration
No external player exposes resume position uniformly. VLC (HTTP/RC interface), mpv (IPC socket), MPC-HC (web interface) and PotPlayer differ; some require enabling interfaces. **Plan:** capability-based integrations with graceful fallback to manual watched/unwatched; never claim universal tracking. Launching is done with argument arrays from the desktop shell; user-added executables are validated and never built into a shell string.

## Metadata licensing
- **IMDb** has no unrestricted free API and forbids scraping; its datasets are licensed for personal, non-commercial use. Theama does not scrape, and does not show IMDb ratings unless sourced from a licensed product the user supplies. Ratings are always labelled by their real provider.
- **TMDB** is free for non-commercial use with attribution; the API key is the user's own, rate limits are respected, and attribution appears in About. If Theama is ever distributed commercially, TMDB's commercial terms apply.
- Provider outages, shutdowns or term changes are contained by the adapter interface and the offline cache.

## Other risks
| Risk | Mitigation |
|---|---|
| **Misidentification** attaching wrong art/metadata | Thresholds + margin, provenance and score stored, manual dialog, match locking, never silent for ambiguous cases (07) |
| **File operations** (renames) can leave inconsistent state | Explicit approval, preview, collision checks, journalled steps with recovery and rollback, refuse while playing (Phase 6) |
| **SQLite growth / locks** | WAL, bounded worker concurrency, keyset pagination, FTS5 contentless-friendly design, backup API |
| **Native module** (`better-sqlite3`) | v13 ships N-API prebuilds for win32-x64/arm64 (no compiler needed; also loads in Electron). Verified installing and opening FTS5 on Node 24. Packaging must copy the `.node` file next to the bundled server. |
| **Dependency churn** | Latest majors chosen deliberately (Vuetify 4, Vite 8, Electron 44, Zod 4, Vitest 5); versions verified against npm on 2026-10-19; Yarn lockfile committed. TypeScript is pinned to 5.9 because TS 7's API compatibility with `vue-tsc` was not evaluated. |
| **Node 24.0.2 `fs.rmSync({ recursive: true })` silently fails on directories with Greek names** (observed here: files inside are removed, the directory stays; `fs.rmdirSync` and `fs.promises.rm` work) | Never use sync recursive removal on user paths. Phase 6 file operations must use `fs.promises.*` and **verify** results, and the project should require a Node release where this is fixed (re-test on upgrade). Tests clean up with `fs.promises.rm`. |
| **Yarn and `ELECTRON_RUN_AS_NODE`** | VS Code exports `ELECTRON_RUN_AS_NODE`, which turns `electron.exe` into plain Node; the dev launcher and e2e strip it. |
| **Yarn build scripts disabled by default** (Yarn 4.18) | Only whitelisted packages (esbuild, electron, sharp) may run install scripts via `dependenciesMeta`; `better-sqlite3` is explicitly *not* built. |
| **Local malware as the same user** | Can read the API token; out of scope for a local single-user app (02 §4). |
| **LAN/mobile later** | Needs its own auth, TLS and opt-in; the loopback token is not reusable for that. |
