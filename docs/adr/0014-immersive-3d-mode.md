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

## Addendum · 2026-10-21 — backdrop scenes (genre and kind) and the preview gallery

**Decision.**
- The backdrop is now one of 17 **scenes** (`SCENE_IDS` in the contract): `classic` (the original, **the default**), `movie`, `series`, `video` and thirteen genre scenes. Settings add `backdropScene` (`auto` or a scene id, default `classic`), `backdropByGenre` and `backdropByKind` (both default `true`, and only used under `auto`). Existing installs have none of these keys stored, so they keep the original backdrop with no migration.
- **Scenes are data.** A scene is a `SceneTheme` (`themes.ts`) assembled from reusable pieces in `layers.ts`: particle modes (drift, rise, fall, wander, rain, bokeh) and shapes, full-screen shader effects (shafts, aurora, nebula, fog, grid, flicker) and a poster layout (field, columns, ring). A new scene is a catalogue entry, not new drawing code. `classic` reproduces the former scene parameter for parameter (a test pins it).
- **Choosing is pure.** `resolve.ts` (no three.js) maps genre names to scenes, tolerant of language, case, accents and the Greek final sigma, with exact names plus stems for English and Greek TMDB genres. A hand-picked scene always wins; only `auto` follows the page: genre (the filter's first pick, or a title's most characteristic genre by priority), then kind, then `classic`. Pages publish `{ kind, genres }` through `useSceneHint`; a page that publishes nothing gets the kind its route implies.
- **Scenes cross-fade** (~0.9 s) and the outgoing one is disposed when it has dissolved. Costly effects (`aurora`, `nebula`, `fog`, `grid`) are off on Low quality; big shapes (bokeh, bubbles) are capped so they do not get denser on a stronger profile.
- **Gallery.** Settings → General lists every scene with a thumbnail. All thumbnails share one offscreen WebGL renderer and are copied into 2D canvases (browsers limit WebGL contexts); only the card under the pointer or focus animates. Cards form an ARIA radio group with a single tab stop.

**Consequences.** Genre names come from TMDB in the metadata language, so the alias table has to know both English and Greek names; unknown genres fall through to the kind scene. The catalogue is part of the contract: adding a scene means a new id there, a theme, and a name and description in both locales (a test enforces all three).
