# ADR-0001 — Yarn 4 workspaces with `nodeLinker: node-modules`

**Status:** accepted · 2026-10-19

**Context.** The user asked for Yarn workspaces and to be told if it is unsuitable. The project has native/binary dependencies (`better-sqlite3`, `sharp`, Electron) and packages an Electron app with electron-builder.

**Decision.** Yarn **4.18.1**, pinned in the repo (`yarnPath` → `.yarn/releases/yarn-4.18.1.cjs`, `packageManager` field) with **`nodeLinker: node-modules`** (not Plug'n'Play).

**Why it is suitable (with that setting).** PnP's virtual filesystem is the part that conflicts with native modules, electron-builder packaging and editor tooling (Volar/vue-tsc). The `node-modules` linker removes those problems while keeping Yarn's workspace protocol, deterministic lockfile and speed. pnpm would be roughly equivalent (strict isolation is nicer) but needs a hoisted layout for electron-builder anyway, so there is no decisive win. Yarn Classic 1.x is not used (maintenance mode).

**Consequences.**
- Corepack is not required: the pinned release is committed, and any Yarn ≥ 1.22 on PATH hands off to it (`yarn set version` did this; Corepack was not enabled on the dev machine).
- Yarn 4.18 **disables dependency build scripts by default**; the root `package.json` whitelists only what needs them (`esbuild`, `electron`, `sharp`) and explicitly sets `better-sqlite3: built:false` because its N-API prebuilds are bundled (building would require a C++ toolchain for no benefit).
- Workspace scripts can only run binaries from their own dependencies, so each workspace lists `typescript`/`vitest` itself.
