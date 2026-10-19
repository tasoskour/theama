# ADR-0006 — Thin, sandboxed Electron shell with a typed IPC bridge

**Status:** accepted · 2026-10-19

**Context.** Electron must open native dialogs, control the service, launch players and Explorer — but must not duplicate backend logic, and the renderer must not gain Node powers.

**Decision.**
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`; permission requests denied; `window.open` denied; navigation limited to Theama's own origins; strict CSP in `index.html`.
- UI is served through a custom **`app://theama`** protocol that refuses anything outside the UI bundle (path-traversal guard).
- **Preload** exposes one object, `window.theama`, typed by `TheamaBridge` in `packages/contracts`. Each IPC channel has a Zod request schema validated in the main process, and the sender frame's origin is checked. (`new URL('app://x').origin` is the string `"null"`, so origins are compared via a small `originOf` helper — found and fixed during e2e.)
- Main and preload are **bundled with esbuild** into single CJS files (zero runtime dependencies besides Electron).
- Window close quits the UI only; the service keeps running. No tray yet.
- Menu labels are localized in the main process (language pushed by the renderer, persisted in a tiny per-user prefs file) so the Service menu is Greek/English like the rest.

**Consequences.** Adding a capability means adding a contract entry + handler + test, which is the intended friction. Actions that start processes (players, later) live here, not in the service.
