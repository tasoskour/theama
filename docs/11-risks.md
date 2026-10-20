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
No external player exposes resume position uniformly. VLC (HTTP/RC interface), mpv (IPC socket), MPC-HC (web interface) and PotPlayer differ; some require enabling interfaces. **Done (ADR-0013):** capability-based integrations for VLC, mpv and MPC-HC/BE (local-only interfaces opened by switches on the command line) with graceful fallback to manual watched/unwatched for everything else; never claim universal tracking. Launching is done with argument arrays from the desktop shell; user-added executables are validated and never built into a shell string.

## Metadata licensing
- **IMDb** has no unrestricted free API and forbids scraping; its datasets are licensed for personal, non-commercial use. Theama does not scrape, and does not show IMDb ratings unless sourced from a licensed product the user supplies. Ratings are always labelled by their real provider.
- **TMDB** is free for non-commercial use with attribution; the API key is the user's own, rate limits are respected, and attribution appears in About. If Theama is ever distributed commercially, TMDB's commercial terms apply.
- Provider outages, shutdowns or term changes are contained by the adapter interface and the offline cache.
- **Attribution:** Settings → Metadata and every identified title page carry TMDB's required statement ("This product uses the TMDB API but is not endorsed or certified by TMDB."). TMDB's *logo* is not bundled (it is their asset and has usage rules); decide with the installer phase whether to add it per their guidelines.
- **Key storage:** the key is a file in `<data>\secrets\tmdb.key`, readable by whoever can read the data folder (the service account and administrators), never in the database, never returned by the API, never logged (a test asserts it). It is not DPAPI-encrypted. A stolen key can only read public movie data, and the user can revoke it at themoviedb.org.
- **Not yet exercised against the live service:** the adapter follows TMDB's documented v3 shapes and is covered by a faithful fake; the first run with a real key may surface a field we did not anticipate. Responses are parsed leniently and any unexpected shape is reported as "provider unavailable" rather than crashing or storing garbage.
- **What leaves the PC:** only the guessed title text and year (and the id of an identified title) go to TMDB; images are fetched by the backend, so the UI never contacts TMDB's CDN directly. Personal videos are never sent.

## Series and collections
| Risk | Detail | Mitigation |
|---|---|---|
| "Missing" is only as good as TMDB's episode list | TMDB sometimes numbers a series differently from release groups (absolute numbering for anime, split or merged seasons, "episode groups"). Files then look *unlisted* and the provider's episodes look *missing*. | Unlisted files stay visible and are never deleted or hidden; the wording says "Not in TMDB's list", not "wrong". Alternative orderings (episode groups) are a follow-up. |
| Undated episodes | No air date means Theama cannot say it is missing. | Shown as *No air date*, counted neither as missing nor as present. |
| Air dates and time zones | Dates are compared in UTC at read time; an episode airing "today" counts as aired. | Off by at most a day around midnight; no scheduling depends on it. |
| Official collections are the provider's | They list franchise films, not story order, and include entries the person may not want. | Shown in release order only, with a note; story order is never inferred. Entries the library lacks are labelled and not playable. |
| Collection data is read once per ~30 days | A new film added to a TMDB set shows up on the next read. | Refreshing any member movie by hand re-reads its set. |
| Title keys for user collections | A user member is stored by title key. If a title's key changes (renamed files, different year in the name), the old member shows as a non-playable entry. | The entry stays removable; the title can be added again. Provider-id based keys arrive with a future title table. |

## Window, tray and tests
| Risk | Detail | Mitigation |
|---|---|---|
| Hidden window with no way back | Closing to the tray with no tray icon would strand the app. | The window only hides when the tray icon exists (`shouldHideOnClose`); a second launch of the app also shows it; the tray icon needs `tray-16.png` beside the app (shipped), otherwise closing just closes. |
| Start with Windows is unverified | It needs the installed app and a sign-in. | Only offered in the installed app (disabled with a reason in development); on the manual checklist. |
| Accessibility audit is partial | Automation finds roughly a third of accessibility problems. | A person's screen-reader pass is on the manual checklist and listed as not done. |
| Timing-sensitive UI tests | In the Electron tests the first click on a page that has just been shown can be missed on a busy machine (after tray or settings changes), and auditing a page mid-fade reports false findings. | The tests wait for the page to settle before the first click and before each audit. If you see a real missed click, this is where to look (it has not been seen outside the test runs). |

## Packaging and updates
| Risk | Detail | Mitigation |
|---|---|---|
| **The installer has not been run** | It compiles (NSIS) and the app it contains passes the packaged smoke test, but installing needs an administrator's approval, so the install, upgrade-with-service and uninstall hooks have only been checked by reading and compiling. | The manual checklist in `docs/10` §6; the hooks are small and use explicit labels, and a failed stop/start never blocks the install. |
| **First real install: a bug found and fixed** | The first install showed *cannot reach its background service*: the service ran `node.exe C:\Program Files\Theama\...\server.cjs` unquoted, so Node looked for the module `C:\Program`. Development and the packaged smoke test never saw it because neither runs from a path with a space. | `service-admin.ps1` now writes the quoted path into the service's `AppParameters` (a test guards it). An already-installed broken service is repaired by installing the new build and using *Repair* in the app, or by setting `AppParameters` to the quoted path. |
| Not code-signed | Windows SmartScreen and some antivirus tools warn about unsigned installers. | Set `CSC_LINK` (a .pfx) and `CSC_KEY_PASSWORD`, then `yarn dist:signed`: it refuses to start without them, signs Theama.exe, the bundled node/nssm/ffprobe, the uninstaller and the installer with a SHA-256 signature and an RFC 3161 timestamp, and ends by checking the result (`yarn verify:signature`). Exercised with a throwaway self-signed certificate; never with a real one. Even a correctly signed installer is still warned about by SmartScreen until it has built reputation, unless the certificate is an EV one. |
| Bundled Node.js | The service runs the Node.js the build ran with, so security fixes arrive with a new Theama build, not with the system's Node. | Rebuild and release when Node ships a security update; `resources\node\VERSION.txt` says which one is inside. |
| FFprobe is GPL | The bundled FFmpeg "essentials" build is GPLv3. | It is only ever started as a separate program; its licence text and readme ship beside it, with the source pointers in `THIRD-PARTY-NOTICES.txt`; it can be replaced by the user's own build. |
| No automatic updates | There is nowhere to host a feed yet. | Update = run a newer installer over the old one (data is kept, the service is stopped and restarted, an automatic *before an upgrade* backup is made). electron-builder already writes `latest.yml` and a block map for when a host (GitHub Releases or any HTTPS folder) is chosen. |
| Restore replaces the library | A wrong restore loses changes made since the backup. | A confirmation that says so, the current state saved first as *before a restore*, the staged file re-checked at start, and a backup from a newer Theama refused. |
| Backups contain library data | Paths, collections, watched marks. | No secrets (the TMDB key and API token are outside the database); the backups folder inherits the data folder's access rules. |
| Service account and upgrades | The service's configured paths point into the install folder. | A different install folder needs *Repair service* in the app. |

## Playback and file renaming
| Risk | Detail | Mitigation |
|---|---|---|
| Launching a program from a UI | A compromised renderer could try to run something. | The UI sends only a **file id** and a player id; the desktop shell asks the backend for the path (a library file), validates it, and starts only detected players or programs the person picked in a native dialog, with `shell: false` and an argument array. Players are stored in the shell's own preferences, never in the backend. |
| Argument injection through file names | A name like `--fullscreen` or one with `&`/quotes. | Paths are absolute (so never start with `-`), passed as single arguments; mpv gets `--` before the file. |
| "Watched" is automatic only for some players | External players do not report progress uniformly. | VLC, mpv and MPC-HC/BE are watched through a local-only interface (loopback, random port or pipe, random password); for every other player the person marks watched and a launch is only remembered as "started". If an interface does not come up nothing is tracked and the player is unaffected. |
| PotPlayer subtitle switch | Its command-line switch for an external subtitle is not documented well enough to rely on. | PotPlayer is started on the video only and listed as "No automatic subtitle". |
| Rename races | A file can change between the preview and the rename, or a name can appear in between. | The server rebuilds the plan at apply time and only runs pairs identical to the approved ones; it checks that the target is free immediately before each rename. The remaining window is milliseconds and ends in a refusal, not an overwrite (Node's rename would overwrite on Windows, which is why the check exists). |
| Rename and identification | Matches are keyed by the grouping key derived from file names. | A renamed file keeps its library row and key (the path is updated in place), so locked matches survive; a later full re-parse of that file could produce another key, in which case the title is simply identified again. |
| Service account permissions | Renames run in the service's account, which may not be allowed to change a user's files. | The failure is shown per file with a plain reason ("Access was denied…"); nothing is half-done. |
| Subtitles named oddly | Release folders use names like `2_English.srt`. | Handled inside a folder named after the video; otherwise the player's own embedded-track handling applies. |

## Scanning and FFprobe
| Risk | Detail | Mitigation |
|---|---|---|
| FFmpeg licensing | FFmpeg builds are LGPL/GPL. | `ffprobe.exe` is a separate process we only execute (never linked or modified); the build is a pinned download, not committed; attribution and licence text must ship with the installer (Phase 7). |
| Download integrity | The FFmpeg zip is ~110 MB. | `tools/ffprobe/fetch-ffprobe.mjs` pins version 9.0.2 and the SHA-256 published by the host, refuses on mismatch, and extracts only `ffprobe.exe`. |
| Incomplete or corrupt files | Real folders contain unfinished downloads (two of 131 in the sample set start with zero bytes). | FFprobe errors are stored per file (*Unreadable*), the scan carries on, and the file is not retried until it changes. |
| Title guessing is only a guess | Grouping is by normalised name, so two different shows with the same name (e.g. two series called *Doctor Who*) merge, and a movie with and without a year in its file name splits. | Display guesses until Phase 4 matches titles to a provider; grouping then uses provider ids. |
| Search folding | SQLite FTS5 `remove_diacritics` ignores Greek accents. | Solved: text is folded by the application (accents, case, final sigma) before indexing and querying; covered by tests. |
| Large libraries in the grid | Grids load 60 titles per page with `content-visibility`, which is fine for thousands but is not true virtualisation. | Measure at 5,000 titles (Phase 3 follow-up); move to a windowed grid if scrolling degrades. |
| Watchers on network shares | `fs.watch` can miss events on SMB shares and after sleep. | Debounced watcher **plus** a 6-hour safety scan and a rescan whenever a folder returns online. |
| A movie in a Series folder | The folder type chosen by the user wins, so it is listed as an unnumbered episode. | By design (explicit classification beats guessing); *Auto-detect* classifies by name. |

## Other risks
| Risk | Mitigation |
|---|---|
| **Misidentification** attaching wrong art/metadata | Thresholds + margin, provenance and score stored, manual dialog, match locking, never silent for ambiguous cases (07) |
| **File operations** (renames) can leave inconsistent state | **Built:** explicit approval of exactly the previewed pairs, collision checks (an existing name is never overwritten), a write-ahead journal, per-item failure handling, Undo that refuses to force, and recovery after a crash by inspecting the disk. A player holding the file open makes Windows refuse the rename (`EBUSY`), which is reported and leaves the file as it was. |
| **SQLite growth / locks** | WAL, bounded worker concurrency, keyset pagination, FTS5 contentless-friendly design, backup API |
| **Native module** (`better-sqlite3`) | v13 ships N-API prebuilds for win32-x64/arm64 (no compiler needed; also loads in Electron). Verified installing and opening FTS5 on Node 24. Packaging must copy the `.node` file next to the bundled server. |
| **Dependency churn** | Latest majors chosen deliberately (Vuetify 4, Vite 8, Electron 44, Zod 4, Vitest 5); versions verified against npm on 2026-10-19; Yarn lockfile committed. TypeScript is pinned to 5.9 because TS 7's API compatibility with `vue-tsc` was not evaluated. |
| **Node 24.0.2 `fs.rmSync({ recursive: true })` silently fails on directories with Greek names** (observed here: files inside are removed, the directory stays; `fs.rmdirSync` and `fs.promises.rm` work) | Never use sync recursive removal on user paths. Phase 6 file operations must use `fs.promises.*` and **verify** results, and the project should require a Node release where this is fixed (re-test on upgrade). Tests clean up with `fs.promises.rm`. |
| **Yarn and `ELECTRON_RUN_AS_NODE`** | VS Code exports `ELECTRON_RUN_AS_NODE`, which turns `electron.exe` into plain Node; the dev launcher and e2e strip it. |
| **Yarn build scripts disabled by default** (Yarn 4.18) | Only whitelisted packages (esbuild, electron, sharp) may run install scripts via `dependenciesMeta`; `better-sqlite3` is explicitly *not* built. |
| **Local malware as the same user** | Can read the API token; out of scope for a local single-user app (02 §4). |
| **LAN/mobile later** | Needs its own auth, TLS and opt-in; the loopback token is not reusable for that. |
