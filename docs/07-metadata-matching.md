# 07 · Metadata providers and matching (Phase 4) — **Built (first slice)**

## 0. What is built, and where it differs from the design below

Built and tested: the provider interface and the **TMDB adapter**, shared request infrastructure (spacing, retry with exponential backoff and jitter, `Retry-After`, circuit breaker, cancel on shutdown), the **matcher**, the **artwork cache**, metadata with per-field English fallback, **manual identification with locking**, refresh, and the UI for all of it.

Differences from the design, deliberately taken for the first slice:

| Design | Built | Why / what is next |
|---|---|---|
| `media_title` table; matches attached to titles | Matches and provider data are keyed by `title_key` (the grouping key of Phase 3) in `title_match`, `title_metadata`, `episode_metadata` | The grouping already identifies "one card"; a `media_title` table can be introduced later by migrating these keys, without losing rows. |
| Score uses title, year, kind, runtime, popularity, sibling consistency | Search-time signals only: **title (0.50), year (0.20), popularity (0.05)**; the sum is divided by the weight actually available, so a missing year does not punish a candidate | Search results carry no runtime, and kind is a hard filter of the search. Runtime and sibling signals can be added when details are fetched for the top candidates. |
| Token-bucket rate limit | Minimum spacing of 40 ms between calls (≈ 25 req/s, under TMDB's limit) | Simpler and equally safe for one user. |
| Credentials in DPAPI-backed storage | One file in the data folder's `secrets` directory (never in the database, never returned by the API, never logged) | Node has no built-in DPAPI; the file shares the trust boundary of the API token next to it. See `docs/11-risks.md`. |
| Local NFO provider | Not built | Priority today: user edit/lock → provider → file name. |
| "This is a series / movie" toggle in the dialog | Not built: the kind follows the files (episodes → series, otherwise movie) | Reclassifying changes the grouping key; planned with Phase 5. |
| Expected-but-absent episode classification | Not built; episode names and details are shown for files that exist | Phase 5. |

How an automatic decision is made (as built): search with the year; if the result is not a clear match and a year was given, search again without it and judge the combined list. **Matched** needs a score ≥ 0.85, a lead of ≥ 0.10 over the runner-up, and (when both sides have a year) a year within ±2. A score of 0.55–0.85, or a close runner-up, is **ambiguous** (the top five are stored with cached thumbnails and offered to the user). Below 0.55 is **unmatched**, retried after seven days. Personal videos are never looked up, and nothing but the guessed title text and year is sent to TMDB.

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
