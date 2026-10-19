# ADR-0009 — Provider abstraction; TMDB primary; no IMDb scraping

**Status:** accepted · 2026-10-19 · implemented 2026-10-20 (first slice; see `docs/07-metadata-matching.md` §0 for what differs from the design)

**Context.** IMDb has no unrestricted free API and prohibits scraping; ratings from one provider must not be presented as another's; the app must work offline.

**Decision.**
- A `MetadataProvider` interface (search / fetch title / fetch season) with shared rate limiting, retry + backoff, caching, a circuit breaker and user-held credentials.
- **TMDB** is the primary provider (attribution required). **Local NFO** and **user edits** are first-class sources. **IMDb** is supported only through data the user is licensed to use (datasets), never scraping.
- Provider ids and ratings are stored **per provider** with provenance; the UI labels ratings by provider.
- Priority: user override → local NFO → cached provider → filename-derived. User edits and locked matches survive refreshes.
- Metadata language is independent of UI language; Greek preferred with per-field English fallback; proper names never machine-translated.

**Consequences.** Adding a provider is an adapter plus capability flags. If a provider changes terms or disappears, cached data keeps the library usable. Details: `docs/07-metadata-matching.md`.
