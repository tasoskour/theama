# ADR-0010 — `ServiceController` abstraction with a development implementation

**Status:** accepted · 2026-10-19

**Context.** The brief requires a development workflow where the backend runs as a normal foreground process, while production uses a Windows service. The same UI (status, start/stop, recovery, logs) should work in both, and tests must not require administrator rights.

**Decision.** One interface (`status/start/stop/restart/install/repair/uninstall/dispose`) with two implementations selected by `THEAMA_CONTROLLER` (default `dev` when unpackaged, `nssm` when packaged):
- `NssmServiceController` — `sc.exe` for status/start/stop (parsed by numeric state code so localized Windows works) and the elevated admin script for install/repair/uninstall.
- `DevProcessController` — runs `node --import tsx src/main.ts` as a child; stop is graceful via a stdin message handled by the server (`THEAMA_STDIN_CONTROL=1`) so the history shows a clean `stop`, matching what NSSM's Ctrl+C produces.

The renderer never knows which is active except through `ServiceStatus.host` (`nssm` | `dev-process`), which it displays; install/repair/uninstall are rejected with an explanation in dev mode.

**Consequences.** The Electron e2e suite exercises the full stop → recovery → start loop with no elevation. The NSSM implementation is tested against a fake Service Control Manager; its real-Windows behaviour needs the manual checklist.
