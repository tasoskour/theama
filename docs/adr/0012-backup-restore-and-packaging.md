# ADR-0012 — Backups are database copies applied at start-up; the installer ships its own runtime

**Status:** accepted · 2026-10-20

**Context.** Phase 7 makes Theama installable and upgradable by someone who is not a developer. Their library is a database that took effort to build (identifications, collections, watched marks). Upgrades change its layout; restores replace it; both happen while a service holds it open.

**Decision.**
- **Backups** use SQLite's asynchronous backup API while the service runs, copying 128 pages per turn and finalizing a standalone database before publishing it. Startup copies before migrations/restores continue to use `VACUUM INTO`. Backups stay in `<data>/backups`, named by kind. Automatic: daily (7 kept), before an upgrade that changes the layout (5), before a restore (3). Manual ones are never deleted by Theama. Secrets and artwork are not in the database and so not in a backup. Restore staging uses a worker to validate and snapshot the selected database, including committed WAL pages, before publishing the staged file.
- **Restore is staged, then applied at the next start**, before the database is opened: validate (read-only open, quick check, expected tables, layout not newer), set aside; at start save the current database as a *before a restore* backup, swap, open (older layouts migrate forward). The API never writes outside the backups and restore folders, and never replaces an open database.
- **The installer carries its own runtime** (Node.js, the backend bundle with its one native module, NSSM, FFprobe) under `resources/`, so the service does not depend on whatever Node the machine has. The data lives outside the install folder.
- **Installer hooks** stop the service before files are replaced and start it after (only if it existed); uninstall removes the service and asks before deleting data (default: keep; an upgrade or silent uninstall always keeps). First install does **not** create the service: the app offers it on first start, where the account can be chosen, keeping credentials out of the installer.
- **Updates** are "run a newer installer". Automatic updates wait for a place to host a feed; nothing pretends otherwise.

**Consequences.** A bad upgrade or restore can always be reversed from a file. The installer is large (~180 MB, mostly Electron and Node) and unsigned until a certificate exists. The install/upgrade/uninstall hooks need a trial on a clean machine, which needs an administrator's approval and is listed as a manual checklist.
