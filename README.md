<p align="center"><img src="packages/brand/assets/icon-128.png" width="96" alt="Theama"></p>

# Theama (Θέαμα)

A private, cinematic library for the movies, series and personal videos on your own drives — local-first, no account, works offline. Windows-first.

**Status: Phases 1–8 (first slices) are built.** Add a folder and Theama scans it (automatically, and again whenever files change or a drive returns), reads each video's details with FFprobe, groups the files into titles (one card per movie, one per series) shown as poster cards on Home, Movies, Series and My Videos, with title pages (seasons and episodes for series), keyboard navigation and accent-insensitive search. Unplugged drives stay in your library, dimmed and labelled *Offline*. The Windows service (managed through NSSM), service controls, log history, English/Greek and dark/light themes are in place. With a free TMDB key (Settings → Metadata) titles are identified automatically in the background, with posters, summaries, cast, ratings (labelled TMDB) and episode names; when Theama is not sure it asks, and your choice is locked. Without a key everything still works. Series pages show which episodes you have, which are missing and which have not aired yet; Collections groups film series from TMDB (naming the parts you lack) and your own lists. Play opens your video in VLC, MPC-HC, mpv or another player you choose (with a subtitle in your preferred language when one sits next to it), you mark what you have watched, and Home offers the next episode. Rename files from a preview, with Undo. A daily (and before-upgrade) backup of the library can be restored from Settings, and `yarn dist` builds a Windows installer. The pages and dialogs are audited for accessibility in both themes and languages, and Theama can stay in the notification area. Code signing, automatic updates, a screen-reader pass and a trial of the installer on a clean machine are what is left — see [the roadmap](docs/09-roadmap.md).

## Quick start (development)

Requires Node.js ≥ 22 (tested on 24) and Yarn (Classic ≥ 1.22 on PATH is enough; the repo pins Yarn 4.18.1).

```bash
yarn install
yarn ffprobe:fetch   # one-time: downloads FFprobe (pinned, checksum-verified) so durations/resolutions/codecs are shown
yarn dev            # Vite + Electron; the backend runs as a plain Node process in .dev-data/
```

No Windows service and no administrator rights are needed for development. If your shell exports `ELECTRON_RUN_AS_NODE` (VS Code does), `yarn dev` clears it for you.

| Command | What it does |
|---|---|
| `yarn dev` | UI dev server + Electron shell (starts the backend itself) |
| `yarn dev:server` | Backend only, with auto-reload |
| `yarn build` | Type-checks and builds every workspace |
| `yarn typecheck` · `yarn lint` | `tsc` / `vue-tsc` · ESLint |
| `yarn test` | Unit + integration tests (Vitest) |
| `yarn test:e2e` | Builds the UI, then runs the Electron end-to-end suite (Playwright) |
| `yarn icons` | Re-renders PNG/ICO assets from `packages/brand/src/*.svg` |
| `yarn ffprobe:fetch` | Downloads FFmpeg 9.0.2 (SHA-256 verified) and keeps only `ffprobe.exe` in `tools/ffprobe/bin/` |
| `yarn nssm:fetch` | Downloads NSSM 2.24 (SHA-256 verified) to `tools/nssm/bin/` |
| `yarn dist` | Builds everything and makes `build/installer/Theama-Setup-<version>.exe` (needs `yarn nssm:fetch` and `yarn ffprobe:fetch --force` once) |
| `yarn pack:dir` · `yarn test:packaged` | Builds the unpacked app · drives it with the packaged smoke test |
| `yarn perf` · `yarn perf --small` | Timing against the performance budgets on a synthetic 5,000-title library |
| `yarn service:install` · `:repair` · `:uninstall` | Install/repair/remove the real Windows service (UAC prompt) |

## Running as a Windows service (NSSM)

```bash
yarn build && yarn nssm:fetch
yarn service:install           # add --system to run as Local System instead of your account
```

Windows asks for administrator permission once (and for your account password when running as your account). After that, **Start / Stop / Restart need no elevation** — use the app's **Service** menu or *Settings → Advanced → Service*. The service keeps running when you close Theama. `yarn service:uninstall` removes it and leaves your data in `%ProgramData%\Theama`.

> The elevated install path is covered by unit tests but has not been run against a real UAC session yet — use the checklist in [docs/10-testing-strategy.md](docs/10-testing-strategy.md) §5.

## Where things live

```
apps/server     Fastify API + WebSocket, SQLite, logging        (the service)
apps/ui         Vue 3 + Vuetify 4 interface
apps/desktop    Electron shell: window, menus, service control, typed IPC
packages/       contracts (shared Zod types) · logs (shared log reader/writer) · brand (logo & icons)
tools/          dev launcher · NSSM fetch + elevated admin script
docs/           PRD, architecture, schema, API, UX, design system, roadmap, risks, ADRs
```

User data (database, logs, cache, API token): `%ProgramData%\Theama\` — never in the install folder. Development uses `.dev-data/`.

## Documentation
[PRD](docs/01-prd.md) · [Architecture](docs/02-architecture.md) · [Domain & database](docs/03-domain-and-database.md) · [API](docs/04-api.md) · [UX & navigation](docs/05-ux-navigation.md) · [Design system & logo](docs/06-design-system.md) · [Metadata matching](docs/07-metadata-matching.md) · [Scanning & offline media](docs/08-scanning-workflow.md) · [Roadmap](docs/09-roadmap.md) · [Testing](docs/10-testing-strategy.md) · [Risks](docs/11-risks.md) · [ADRs](docs/adr/)
