# ADR-0011 — Players are started by the desktop shell; renames go through a journal

**Status:** accepted · 2026-10-20 · the "no resume, no automatic watched" part is amended by ADR-0013

**Context.** Phase 6 lets Theama start external players and rename a person's files. The first can run a program on the person's PC; the second can destroy data. The backend may run as a Windows service in another session and account, and the UI is a renderer we want to keep unable to do either on its own.

**Decision.**
- **Playing.** The UI sends only a file id (and optionally a player id) over typed IPC. The desktop shell asks the backend for that file's path and subtitle (`GET /playback/files/:id/launch`), validates the path, and starts a **detected** player or a program the person chose through a native dialog, with `shell: false` and an argument array. The list of players lives in the shell's own preferences file. The backend never launches anything.
- **Watched** is a mark per file, set by the person. A launch is recorded as "started". Automatic tracking and resume position are not claimed (external players do not expose them uniformly); they are future per-player integrations.
- **Subtitles** are read from disk when needed (nothing is cached or stored) and chosen from an ordered list of preferred languages; forced-only subtitles are never chosen.
- **Renaming** is in place only (no moves, no deletes, no overwrites). A preview computes everything and changes nothing. Applying takes the exact `{from, to}` pairs the person approved, rebuilds the plan and runs only pairs that still match. Every rename is written to a journal as `pending` before it happens and marked afterwards; Undo reverses what is still safe to reverse and reports the rest; after a crash the journal plus the disk say what happened. A subtitle that shares a video's name is renamed with it.

**Consequences.** A compromised UI can ask for "play file 7" but not "run this program". Renames are recoverable and never silent. The cost: no resume, no automatic watched, and Windows file locks (an open player) simply make a rename fail for that file.
