# 06 · Design system

**Keywords:** artistic · Greek-inspired · cinematic · editorial · minimal · timeless · refined · atmospheric. Original identity; inspired by streaming-app interaction patterns, not their branding or layouts.

Source of truth in code: `apps/ui/src/theme/vuetify.ts` (colors), `apps/ui/src/styles/global.css` (type, focus, motion), `packages/brand` (logo/icons).

## 1. Color

Warm charcoal and ivory, with a muted bronze accent. Vuetify themes `theamaDark` and `theamaLight`; components read `rgb(var(--v-theme-*))`, so a token change propagates everywhere.

| Token | Dark | Light | Use |
|---|---|---|---|
| `background` | `#0F0E0C` | `#F6F1E7` | Page |
| `surface` | `#171510` | `#FCF9F2` | Cards, top navigation, lists and window controls overlay |
| `surface-light` / `surface-variant` | `#1F1C16` / `#2A261E` | `#F0EADB` / `#E6DEC9` | Hover rows, tonal fills |
| `on-surface` | `#EFE8DA` | `#1C1A16` | Primary text |
| `on-surface-variant` | `#B9AF9C` | `#5B5446` | Secondary text |
| `primary` | `#C9A66B` | `#85653A` | Accent, focus ring, active nav, key actions |
| `on-primary` | `#17120A` | `#FFFFFF` | Text on primary |
| `secondary` | `#8F7A56` | `#6F6247` | Quiet accents |
| `error` / `warning` / `success` / `info` | `#E0806F` / `#DCA94E` / `#93B47E` / `#82A5BD` | `#B3412F` / `#855A0C` / `#4F7340` / `#3F6783` | Status |
| `hairline` | `#3A352A` | `#D6CCB4` | 1 px borders |

**Measured contrast (WCAG 2.x):** all text/background pairs ≥ 4.5:1 in both themes — body text 15.8:1 (dark) / 15.4:1 (light); secondary text 8.9 / 6.7; primary-on-background 8.4 / 4.8; on-primary 8.1 / 5.4; status colors ≥ 6.9 (dark) and ≥ 4.8 (light; light *warning* was darkened from `#9A6A12` at 4.2:1 to `#855A0C` at 5.4:1). `hairline` borders are decorative (≈1.5:1) and are never the only indication of a control's boundary.

Gradients are soft and used sparingly (icon background, hero scrims later). Image treatments: rounded corners (10 px), subtle inner border, scrim for text-over-image.

## 2. Typography

| Role | Face | Notes |
|---|---|---|
| Display / page titles / hero | **Noto Serif Display** (variable) | Editorial serif; full Greek coverage; `.th-display` class |
| UI / body | **Inter** (variable) | Modern sans; Greek subset included |
| Mono (logs, paths, ids) | system UI monospace stack | `.th-mono` |
| Eyebrow | Inter, 0.72 rem, +0.18 em tracking, uppercase, bronze | `.th-eyebrow` |

Both fonts are bundled locally through `@fontsource-variable/*` (the app works fully offline; no CDN). Greek is a first-class language, not a fallback: the serif and sans both ship Greek glyphs, and `<html lang>` follows the UI language so `text-transform: uppercase` on eyebrows applies the Greek rule (accents are dropped in all-caps, which is correct Greek typography).

Scale: fluid titles with `clamp()` (e.g. page title `clamp(2rem, 4vw, 3rem)`), body 1 rem / 1.6, captions 0.75–0.85 rem.

The root type size stays at the browser's default (normally 16px) through 1280 CSS pixels, grows smoothly to 20px at 2560px, and caps there for larger windows, including 3840px and 4096px displays. Relative units preserve browser font preferences. Settings → General → Text size applies a multiplier on top: Small 90%, Default 100%, Large 115%, Extra large 130%. At 4096px this gives a default 20px body or 26px with Extra large. The preference applies immediately, is cached for first render, and is saved through the shared settings service.

Fields, menus, dialogs, captions, and navigation follow the root size. Fluid title viewport terms also use the multiplier. Action rows and filters wrap, and navigation switches to icons based on available space relative to text size. Posters retain their existing layouts.

## 3. Spacing, shape, elevation
4 px base grid; page gutters `clamp(16px, 4vw, 56px)`; standard content max-width 1400 px and media-browsing max-width 1800 px; radius 10 px (`--th-radius`), buttons/cards `lg`; **no drop shadows** in dark, a restrained 1 px hairline instead; flat Vuetify elevations throughout (defaults set in `createVuetify`).

## 4. Focus
Single, consistent ring: `2px solid primary`, `outline-offset: 2px`, applied through `:focus-visible` globally. Poster focus (Phase 3) adds the same slight lift as hover. Focus must never be hidden by `overflow` clipping: rails reserve padding for the ring.

## 5. Motion
Short (160 ms, ease-out) fades for page changes and focus; no parallax, no looping animation. `prefers-reduced-motion: reduce` collapses all animation/transition durations globally (implemented in `global.css`). Hero image crossfades and poster elevation arrive with Phase 3 and follow the same rule.

**Immersive 3D mode (optional, off by default).** Settings → General → Visual mode. When active, `<html>` carries `th-immersive` and every 3D style hangs off that class, so Standard is exactly the rules above. The mode adds a three.js backdrop behind the page (dust, light shafts, out-of-focus posters), poster tilt with a moving highlight, depth on rails and grids (CSS scroll-driven animations) and a push-through page transition. Rules: the backdrop is decorative (`aria-hidden`, no pointer events); real UI stays DOM so keyboard navigation and screen readers are unchanged; depth effects never fade text (contrast must hold wherever a card sits); it is not applied under `prefers-reduced-motion` or without WebGL; quality (Low/Medium/High) is user-chosen and lowered automatically if the frame rate suffers. The backdrop has 17 scenes (Classic, the default; Movie, Series, Video; and 13 genres), picked by hand or by Automatic (genre, then kind) in Settings → General, which has a live preview gallery. A new scene is a `SceneTheme` entry in `immersive/themes.ts` and must keep text contrast: scenes stay dim and low-contrast behind the content. See ADR-0014. Note: Vue 3.5.44 drops the selector after a leading `:global()` in scoped CSS, so immersive rules live in unscoped `<style>` blocks anchored on `data-poster-card` / `data-poster-cell` / `data-rail`.

## 6. Components
Implemented: `TheamaAppShell`, `TheamaTopNavigation`, `TheamaBottomNavigation`, `BrandLogo`, `ConnectionChip`, `EmptyLibraryState`, `SectionPage`, `ServiceStatusCard`, `ServiceControls`, `ServiceInstallDialog`, `RecoveryScreen`, `LogList`.
Planned (brief §13): `MediaPosterCard`, `MediaLandscapeCard`, `MediaCarousel`, `FeaturedHero`, `MediaDetailsHero`, `MetadataChips`, `CastCarousel`, `CollectionCarousel`, `SeasonSelector`, `EpisodeCard`, `ContinueWatchingCard`, `ScanProgressIndicator`, `PlayerSelectionDialog`, `MediaMatchingDialog`, `RenamePreviewDialog`, `SubtitleManager`, `LibrarySourceManager`. Cards get an **availability** variant (dimmed artwork + badge) for offline media.

## 7. Logo and icon

**Concept.** A Greek capital **Θ** (theta — the initial of *Θέαμα*) drawn as a camera **lens**: the bowl is the lens ring, the crossbar is the film-gate slit, a small dark circle is the lens glint. A thin outer ring with two horizontal ticks frames it like a classical medallion or aperture. Bronze gradient (`#E3C58A → #B8925A → #8A6A3C`) on near-black; flat on light backgrounds.

| Asset | Source (`packages/brand/src`) | Output (`packages/brand/assets`) | Used for |
|---|---|---|---|
| Mark | `logo-mark.svg` | same (SVG) | In-app brand mark (top navigation, app bar, splash) |
| Lock-up | `logo-full.svg` | same | README/docs, marketing; mark + THEAMA / ΘΕΑΜΑ wordmark |
| App icon | `icon.svg` (rounded square, dark radial background) | `icon-16…1024.png`, **`theama.ico`** (16–256) | Window, taskbar, installer, favicon |
| Monochrome | `icon-monochrome.svg` | `tray-16/24/32.png` | Tray / small single-color uses |

Rules: minimum mark size 16 px (the app icon uses heavier strokes than the standalone mark so the Θ stays legible small); clear space ≥ ¼ of the mark's width; do not recolor the bronze gradient, stretch, or place the dark-glint circle on a non-dark ground (use the monochrome mark instead).

Regenerate with `yarn icons` (sharp + png-to-ico). Outputs are committed so a fresh clone runs without rendering. The wordmark in `logo-full.svg` is live text that falls back through `Noto Serif Display → GFS Didot → Georgia`; inside the app the wordmark is HTML text in the bundled font, so it is always correct. Outline the text in a vector editor before using the file where the font may be missing.
