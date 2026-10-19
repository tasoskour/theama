# ADR-0005 — Vuetify 4, Vite 8, and a pinned TypeScript 5.9

**Status:** accepted · 2026-10-19

**Context.** The brief specifies Vuetify 3 "unless a technically justified alternative is clearly superior." Versions were checked on npm on 2026-10-19: Vuetify 4.2.6, Vite 8.3.4, Vue 3.5.44, Pinia 4.1, Vue Router 5.4, vue-i18n 11.4, Electron 44.9, Zod 4.6, Vitest 5.0, Playwright 1.64, TypeScript 7.0 (latest).

**Decision.**
- **Vuetify 4** (still Vue 3, current major; starting a new product on a superseded major would just defer a migration). Themes, defaults and components are customised in one file so the identity does not look like a stock dashboard.
- Vite 8 + `@vitejs/plugin-vue` 6 + `vite-plugin-vuetify` 2.1 (auto-import).
- **TypeScript pinned to `~5.9.3`**, not the newest. `vue-tsc` 3.3 declares `typescript >= 5.0.0`, but its compatibility with the TS 6/7 line was **not evaluated**; 5.9 is the conservative, known-good choice. Revisit when `vue-tsc` documents support.
- Icons: `@mdi/js` SVG paths through Vuetify's `mdi-svg` set (tree-shaken, no icon font, works offline).
- Fonts: Noto Serif Display (display, has Greek) and Inter (UI, has Greek), bundled via `@fontsource-variable/*`.

**Consequences.** Vuetify 4 differs from 3 in places; examples and community answers for v3 may not apply verbatim. All UI strings go through vue-i18n; a test enforces key parity and that every used key exists. The production entry chunk is ≈158 kB (≈56 kB gzipped) plus lazily loaded route chunks.
