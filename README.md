<p align="center"><img src="packages/brand/assets/icon-128.png" width="96" alt="Theama"></p>

# Theama (Θέαμα)

A private, cinematic library for the movies, series and personal videos on your own drives — local-first, no account, works offline. Windows-first.

**Status: Phase 1 (foundation) is built.** The desktop app, the background service (managed through NSSM), the local API, SQLite, English/Greek, dark/light themes, **service management** and **log history** work. Media scanning, posters and metadata arrive in the next phases — see [the roadmap](docs/09-roadmap.md).

## Quick start (development)

Requires Node.js ≥ 22 (tested on 24) and Yarn (Classic ≥ 1.22 on PATH is enough; the repo pins Yarn 4.18.1).

```bash
yarn install
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
| `yarn nssm:fetch` | Downloads NSSM 2.24 (SHA-256 verified) to `tools/nssm/bin/` |
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
