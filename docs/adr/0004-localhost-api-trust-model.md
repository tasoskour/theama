# ADR-0004 — Loopback API protected by token, Host and Origin checks

**Status:** accepted · 2026-10-19

**Context.** Any web page can send requests to `http://127.0.0.1:<port>`, and DNS rebinding can make a hostile domain resolve there. The API will eventually expose file renames, so "no auth because it is local" is not acceptable.

**Decision.** Defence in depth, all enforced in the server's `onRequest` hook:
1. Bind to `127.0.0.1` only.
2. **Host header** must be a loopback name (defeats DNS rebinding).
3. **Origin**, when present, must be on an allowlist (`app://theama`, plus the Vite dev origin in development); CORS is restricted to the same list.
4. **Bearer token** (32 random bytes) required on every REST call and on the WebSocket upgrade, compared in constant time. Stored in `<data>\secrets\api-token`, ACL-limited to SYSTEM, Administrators and the installing user.
5. The Electron **main process** injects the header for requests to the backend's exact port; the renderer never receives the token.
6. Even `/health` needs the token.

**Consequences.** A hostile web page cannot call the API (no token, wrong origin). Another Windows user cannot read the token. Malware running as the same user can — documented as out of scope. A future LAN mode must add real authentication and TLS; this token is not designed for that. Running the UI in a plain browser in development needs `VITE_API_BASE`/`VITE_API_TOKEN`.
