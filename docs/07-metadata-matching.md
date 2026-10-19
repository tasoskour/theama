# 07 · Metadata providers and matching (Phase 4) — **Designed**

## 1. Provider abstraction

```ts
interface MetadataProvider {
  id: 'tmdb' | 'nfo' | 'user' | string
  capabilities: { movies: boolean; series: boolean; episodes: boolean; collections: boolean; credits: boolean; artwork: boolean; ratings: 'none' | 'provider' }
  search(query: { kind: 'movie' | 'series'; title: string; year?: number; language: string }): Promise<Candidate[]>
  fetchTitle(externalId: string, language: string): Promise<ProviderTitle>
  fetchSeason?(seriesId: string, season: number, language: string): Promise<ProviderSeason>
}
```
Every call goes through shared infrastructure: token-bucket **rate limiting**, **retry with exponential backoff + jitter**, response **caching** (so offline use works), a **circuit breaker** (the UI stays fully usable while a provider is down), and user-supplied **credentials** (stored with Windows DPAPI-backed storage, never in the DB in clear text).

| Provider | Role | Licensing stance |
|---|---|---|
| **TMDB** | Primary for titles, imagery, cast, seasons/episodes, collections | Free API key; attribution required ("uses TMDB … not endorsed or certified by TMDB"); show their logo in About |
| **Local NFO** | Trusted local overrides (opt-in) | User's own data |
| **User** | Manual edits (highest priority) | — |
| **IMDb datasets** | Optional, only if the user supplies a licensed/permitted data product | **Never scraped.** Non-commercial datasets only for personal use per IMDb's terms; otherwise disabled. |

**Ratings are attributed per provider.** A TMDB rating is shown as "TMDB 7.9", never as an IMDb rating. The IMDb id may be stored as an *identifier* (TMDB exposes it) without implying an IMDb rating.

**Priority:** user override → local NFO (if enabled) → cached provider → filename-derived.

**Language:** metadata language is independent of UI language. Greek is requested when preferred; fields the provider has no Greek value for fall back to English *per field*. Proper names (titles, people) are never machine-translated.

## 2. Identification pipeline

1. **Normalise** file + parent folder names: strip extension, replace `.`/`_`, drop bracketed tags, remove quality/codec/source/release-group/language noise (`2160p`, `BluRay`, `x265`, `REMUX`, `WEB-DL`, `HEVC`, `-GROUP`…), extract year `(19|20)\d\d`, extract `SxxEyy`, `NxNN`, `Exx-Eyy`, `Season N/NN - Title` patterns (multi-episode supported).
2. **Classify** movie / series / personal video: folder library type wins when the user set one (`My Videos` is **never** auto-matched); otherwise episode patterns ⇒ series, else movie. Ambiguity ⇒ `unclassified`, kept for manual action.
3. **Search** providers with title + year (+ language); try year ±1 and a title-only fallback when empty.
4. **Score** each candidate (0–1):

| Signal | Weight |
|---|---|
| Title similarity (normalised Levenshtein/token-set on title and original title, diacritics-folded, Greek-aware) | 0.50 |
| Year agreement (exact 0.20; ±1 0.10; none 0) | 0.20 |
| Kind agreement (movie vs series) | 0.10 |
| Runtime vs probed duration (within 10 %) | 0.10 |
| Popularity tiebreak (log-scaled, small) | 0.05 |
| Parent-folder / sibling consistency (other files in the folder matched the same title) | 0.05 |

5. **Decide**: top ≥ **0.85** and ahead of the runner-up by ≥ **0.10** ⇒ auto-assign with provenance; top in **0.55–0.85**, or a tie ⇒ **ambiguous**, queued for the user with the top 5 candidates; below **0.55** ⇒ **unmatched**.
6. **Persist** `media_match(title_id, provider, external_id, score, signals JSON, decided_by: auto|user, locked, created_at)`. Clearly wrong metadata is never attached silently: auto-assignment requires the thresholds above and a sanity check (e.g. year within ±2, kind agreement).
7. **Manual identification dialog**: search box prefilled from the normalised name, candidate list with poster/year/overview, "this is a series/movie" toggle, choose ⇒ match recorded with `decided_by = user` and **locked**. Locked matches are skipped by rescans and refreshes; "Unlock" is explicit.

## 3. Episodes
Series match ⇒ fetch seasons/episodes ⇒ map files by (season, episode), supporting ranges (`E03-E04` covers 3 and 4). Remaining local files become *unmatched*, duplicates are flagged, specials map to season 0, and unknown numbers stay visible. Expected-but-absent episodes are classified: **missing locally** (aired, no file) · **not yet aired** (air date in the future) · **excluded by filter** · **not in provider data**.

## 4. Failure behaviour
Provider down / rate-limited / offline: matching is queued and retried with backoff; the library remains fully browsable from cached data; the UI shows a quiet notice, never an error wall.
