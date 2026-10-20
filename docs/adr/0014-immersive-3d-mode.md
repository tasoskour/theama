# ADR-0014 — Optional immersive 3D mode (three.js)

**Status:** accepted · 2026-10-21

**Context.** The interface is calm and editorial. The owner wanted a second, opt-in mode that feels more cinematic, chosen in settings, without giving up what the standard interface already gets right: keyboard navigation, screen-reader semantics, search and filters, and low resource use.

**Decision.**
- Two new persisted settings, `visualMode` (`standard` | `immersive`, default `standard`) and `graphicsQuality` (`low` | `medium` | `high`, default `medium`). They live in `AppSettings` like every other setting (one JSON row each); there is no settings migration (the database schema version is unaffected). The last values are also cached in `theama.prefs` so the mode is right on first paint.
- **3D is a decorative layer, not a second UI.** A fixed, `aria-hidden`, pointer-less `<canvas>` behind the page draws a three.js scene. All real content stays DOM, so every existing behaviour (roving tabindex grids, rails, filters, a11y tests) is untouched. Poster tilt, rail curvature and grid reveals are CSS 3D transforms, the latter two driven by scroll-driven animations (no script).
- **Nothing loads in Standard mode.** The backdrop is a dynamic import; three.js ships as its own chunk (~525 kB, ~133 kB gzipped) fetched only when the mode is switched on. `three` is the only new dependency.
- **`useImmersive()` is the single gate.** 3D runs only if the setting is on **and** WebGL can create a context **and** the OS has not asked for reduced motion. Otherwise the standard interface is used and Settings says why. Everything 3D reads that one composable, and it mirrors the answer onto `<html class="th-immersive">`, which all 3D CSS keys off.
- **Self-protecting.** The first ~90 frames are timed; if the median frame is too slow the quality drops one level for the session (the saved setting is not changed). Repeated WebGL context loss gives up on 3D for the session.
- Poster artwork reaches the scene through the existing artwork URLs, loaded with `crossOrigin='anonymous'`; the service already answers CORS for the app's allowed origins. A failed load keeps the generated stand-in.

**Consequences.** One more dependency and a larger optional chunk. Depth effects must not fade text (axe contrast checks see the final colours). Vue 3.5.44 mishandles a leading `:global()` in scoped CSS, so these styles are unscoped and anchored on data attributes. Covered by unit tests (quality profiles, contracts, API persistence) and `apps/desktop/e2e/immersive.spec.ts`, which drives the real Electron shell with a real library.
