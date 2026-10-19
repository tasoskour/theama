# ADR-0002 — Backend runs as an NSSM-hosted Windows service

**Status:** accepted · 2026-10-19 (user decision; supersedes an earlier recommendation of a per-user background agent)

**Context.** The brief wants a background service that survives the UI closing. A Node.js script is not a native service, so it needs a host. Trade-offs of a *true* Windows service were explained to the user: Session 0 isolation, elevation needed to install, LocalSystem rights, no per-user mapped drives. The user chose the service and **NSSM** as host, with a UI to manage it and a log history.

**Decision.**
- `node.exe server.cjs` supervised by **NSSM 2.24**: delayed auto-start, restart on exit (5 s delay, 15 s throttle), stdout/stderr captured with rotation, 20 s graceful-stop window.
- **Account chosen at install**: the user's own Windows account (default; password entered once in the standard credential dialog) or Local System.
- **Install/repair/uninstall** run an elevated PowerShell script (`tools/nssm/service-admin.ps1`) via `Start-Process -Verb RunAs`; they accept a fixed verb set and validated parameters, and report through a result file.
- **Day-to-day control without elevation:** install sets a service ACL granting the installing user query/start/stop, so the app's Service menu uses plain `sc.exe` calls.
- A `ServiceController` interface hides the host from the rest of the app; `DevProcessController` provides the same semantics for development and tests.
- NSSM is downloaded by a script that verifies a pinned SHA-256 (also matches the published SHA-1), not committed as a binary.

**Consequences.**
- One UAC prompt for install/repair/uninstall; none for start/stop/restart.
- All interactive actions stay in the Electron shell (a service can't reliably show UI).
- Network media must use UNC paths (services don't see mapped drive letters).
- NSSM is unmaintained; replacing it (e.g. WinSW) touches the PowerShell script and `NssmServiceController` only.
- **Not yet verified on a real UAC session** (see `docs/11-risks.md`); a manual checklist exists in `docs/10-testing-strategy.md`.
