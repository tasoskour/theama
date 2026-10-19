# THEAMA (Θέαμα) — Master Architecture & Implementation Prompt

## 1. Your Role

You are a senior software architect, full-stack TypeScript engineer, desktop application developer, and UX/UI designer.

Your task is to **plan, architect, and implement Theama**, a sophisticated Windows-first personal media library application for organizing, browsing, and watching locally stored movies, TV series, and personal videos.

Approach this as a real production software project rather than a prototype.

Make sound architectural decisions, explain important trade-offs, and produce clean, modular, maintainable, strongly typed code.

**Do not immediately generate the entire application. First design its architecture, data model, UX flows, component structure, implementation plan, and development milestones. Then implement incrementally.**

Theama should combine:

- Netflix's intuitive browsing and content discovery.
- Plex/Jellyfin's local media management.
- IMDb's rich title information and relationships.
- MUBI's artistic, editorial visual identity.
- A modern desktop application's reliability and native OS integration.

The application must remain lightweight, responsive, local-first, and usable without accounts or subscriptions.

---

# 2. Product Vision

**Application name:** Theama  
**Greek:** Θέαμα  
**Meaning:** Spectacle; something seen or watched.

Theama is a private entertainment space that transforms ordinary local folders into a beautifully curated cinematic library.

Users select folders containing their media, and Theama automatically discovers, analyzes, identifies, categorizes, and visually presents the content.

Instead of seeing filenames and directories, users see:

- Rich cinematic posters.
- Backdrops and descriptions.
- Organized film collections.
- Series, seasons, and episodes.
- Cast, genres, keywords, and ratings.
- Playback options.
- Personalized libraries.
- Search and content discovery.

The application must not feel like a traditional file browser.

**Core product philosophy:**

1. Navigation is the primary experience.
2. Local files are the source of truth.
3. Metadata enriches content but never replaces local ownership.
4. The user always controls file changes.
5. Everything should remain functional offline after metadata is cached.
6. The user should rarely need to understand the underlying folder structure.
7. No account, authentication, or cloud backend is required.
8. A single person should be able to install and use Theama with minimal configuration.

---

# 3. Technology Stack

Use the following stack unless a technically justified alternative is clearly superior.

## Backend

- Node.js, current supported LTS
- TypeScript, strict mode
- Fastify for the local REST API
- WebSocket for live status updates
- SQLite for persistent local application data
- Drizzle ORM or a similarly lightweight typed persistence layer
- Zod for request and configuration validation
- Worker threads or a job queue for expensive background tasks
- FFprobe for media inspection
- FFmpeg as an optional component for thumbnails or media processing
- A Windows Service wrapper compatible with the chosen Node.js deployment strategy

## Frontend

- Vue 3, Composition API
- TypeScript
- Vuetify 3
- Vite
- Pinia
- Vue Router
- Vue I18n
- Responsive layouts with custom Vuetify themes
- Virtual scrolling where necessary
- Accessible, keyboard-friendly components

## Desktop Shell

Use Electron to package the frontend as a Windows executable.

Required behavior:

- Launch Theama.exe to open the desktop UI.
- Connect to the locally installed backend Windows Service.
- Detect service availability.
- Provide useful recovery actions when the service is unavailable.
- Open native Windows file and folder selection dialogs.
- Launch external video players.
- Open containing folders in Windows Explorer.
- Support installation and uninstallation.

Electron must not duplicate backend business logic.

## Data Storage

Use SQLite for:

- Media entries
- Library sources
- Movie and series relationships
- Episodes
- Metadata
- Tags
- Artwork references
- Playback progress
- External player preferences
- User edits and overrides
- Scan history
- File identity and rename tracking

Use LocalStorage only for lightweight frontend state, such as temporary navigation preferences.

Store cached artwork in the application's local data directory.

Do not place the database or mutable application data inside the installed executable directory.

---

# 4. Application Architecture

Build Theama using three primary components.

## A. Background Windows Service

The service owns:

- Media library indexing
- Folder scanning
- Filesystem monitoring
- Metadata resolution
- Artwork downloading and caching
- Database access
- Library organization
- Search indexing
- Playback metadata
- File rename operations
- External player configuration
- Subtitle discovery
- Background task management

The service must work independently of the desktop UI and continue running after the UI closes.

Consider service security carefully.

A Windows Service may run in a different user session from the desktop app. Operations requiring interactive UI, such as launching VLC or opening Windows Explorer, must execute through an appropriate desktop-side Electron bridge rather than attempting to display windows directly from the service.

## B. Desktop Frontend

Responsible for:

- Navigation
- Browsing
- Search
- Filtering
- Content presentation
- Details pages
- Settings
- File organization workflows
- Playback controls
- User interactions

Keep frontend components focused on presentation and interaction.

## C. Local API

Expose versioned endpoints using a consistent contract.

For example:

- `/api/v1/library`
- `/api/v1/movies`
- `/api/v1/series`
- `/api/v1/episodes`
- `/api/v1/videos`
- `/api/v1/search`
- `/api/v1/collections`
- `/api/v1/tags`
- `/api/v1/metadata`
- `/api/v1/players`
- `/api/v1/subtitles`
- `/api/v1/settings`
- `/api/v1/scans`

Use typed API request and response contracts shared between frontend and backend.

Use WebSocket notifications for scanning, metadata updates, library changes, and background task progress.

Bind the local API to loopback by default.

Do not expose filesystem modification endpoints to arbitrary websites. Design localhost security, request authorization, CORS restrictions, and origin validation appropriately.

If mobile access over a local network is added later, treat it as a separate, explicitly enabled feature with an appropriate security model.

---

# 5. Main Application Sections

Theama has exactly three primary library sections:

1. Movies
2. Series
3. My Videos

Global search, collections, activity, and settings exist as supporting navigation destinations.

## 5.1 Movies

Present movies using cinematic poster artwork and interactive content rows.

Support:

- Movie title
- Original title
- Release year
- Description
- Genres
- IMDb rating, when legitimately available
- Cast and crew
- Director
- Runtime
- Language
- Country
- Poster and backdrop
- Resolution and media information
- Watched/unwatched status
- Playback progress
- Tags
- Collections
- Sequels and prequels
- Shared cinematic universes

### Movie Collections

Movies belonging to a franchise or universe must be clearly associated.

Examples:

- The Lord of the Rings
- Harry Potter
- Star Wars
- The Marvel Cinematic Universe

Support multiple relationships rather than assuming a movie can belong to only one grouping.

Distinguish:

- Official collections
- Sequels and prequels
- Shared universes
- User-created collections

A movie may belong to several collections simultaneously.

Offer alternative collection sorting:

- Release order
- Chronological story order, where curated data exists
- Custom order

Never fabricate chronological relationships.

Only show available local movies as playable. Missing titles in a collection may optionally appear as clearly labeled contextual entries, not as playable content.

### Movie Details

Selecting a movie should open an elegant, immersive details experience.

Include:

- Backdrop hero section
- Primary movie information
- Play button
- Continue watching, where applicable
- Poster
- Synopsis
- Rating and metadata
- Cast carousel
- Collection associations
- Similar titles from the local library
- Technical media information
- Subtitle information
- File actions

The primary CTA must always be obvious.

---

# 5.2 Series

TV series must be treated as structured episodic content rather than individual unrelated video files.

Hierarchy:

Series → Seasons → Episodes → Video Files

Support:

- Series metadata
- Season metadata
- Episode metadata
- Episode numbering
- Special episodes
- Episode descriptions
- Air dates
- Runtime
- Posters and backdrops
- Watched indicators
- Continue watching
- Next episode
- Season completion progress

### Episode Detection

Recognize common naming formats:

- `Breaking.Bad.S01E01.mkv`
- `Breaking Bad - 1x01.mp4`
- `Breaking.Bad.S02E03-E04.mkv`
- `Series Name/Season 01/01 - Episode Title.mkv`

Support multi-episode files.

Preserve original filenames in the database.

Handle inconsistent naming gracefully.

### Missing Episodes

Compare detected local episodes against known episode listings from metadata providers.

Display:

- Available locally
- Missing from the local library
- Unmatched files
- Duplicate files
- Specials
- Unknown episode numbers

Example:

Season 2 — 10 expected episodes, 8 available locally, 2 missing.

Distinguish an episode that is missing locally from one that has not yet aired, is excluded by filters, or is absent from the metadata source.

Offer a season overview with a visually clear episode grid/list.

Episode metadata must not require downloading or possessing the episode.

### Continue Watching

For partially watched series, show:

- Current episode
- Playback position
- Next episode suggestion
- Series completion progress

Implement automatic next-episode selection using sensible rules.

---

# 5.3 My Videos

My Videos is designed for personal media that does not belong to IMDb-style film or television catalogs.

Examples:

- Family recordings
- Personal projects
- Travel videos
- Archived clips
- Home videos
- Edited videos
- Miscellaneous recordings

Do not attempt to automatically match these files against movie databases by default.

Support:

- Custom title
- Custom description
- Custom tags
- User-selected poster or thumbnail
- Custom collections
- Date recorded
- Date imported
- Duration
- File information
- Folder grouping
- Favorite status

Generate local thumbnails when possible.

Allow users to classify imported folders explicitly as Movies, Series, My Videos, or Auto-detect.

Ensure automatic detection never forces personal recordings into incorrect movie matches.

---

# 6. Folder Management and Media Discovery

Users must be able to manually add one or multiple folders.

Examples:

- `D:\Movies`
- `E:\TV Shows`
- `F:\Personal Videos`

Each source should allow:

- Assigning a library type
- Recursive scanning
- Scan exclusions
- Rescanning
- Automatic filesystem watching
- Enabling/disabling the source
- Removing the source from Theama
- Viewing scan status

Removing a library source must not delete media files.

### Supported Formats

Initially support detection of common video formats:

- MKV
- MP4
- AVI
- MOV
- WMV
- M4V
- MPEG
- TS
- WebM

Make extensions configurable.

### Scanning Requirements

- Perform initial scans in the background.
- Display scan progress.
- Do not freeze the UI.
- Use incremental scanning.
- Avoid unnecessary repeated metadata requests.
- Detect added, removed, moved, and renamed files.
- Gracefully handle disconnected external drives.
- Avoid automatically deleting metadata for temporarily unavailable drives.
- Handle Windows paths and Unicode filenames.
- Prevent duplicate indexing caused by overlapping source folders.
- Avoid symbolic link/reparse point loops.
- Support large libraries containing thousands of files.

Distinguish unavailable files from definitively removed files.

Persist scan jobs and meaningful diagnostic information.

Do not run expensive filesystem operations on the main Electron process.

---

# 7. Intelligent File Identification

Implement a robust identification system.

A file's original name may be noisy or inconsistent.

Examples:

`Interstellar.2014.2160p.BluRay.x265.mkv`

`The.Dark.Knight.2008.REMUX.mkv`

`Dune.Part.Two.2024.1080p.WEB-DL.mkv`

`The.Last.of.Us.S01E03.HEVC.mkv`

Normalize candidate names by identifying:

- Title
- Release year
- Season
- Episode
- Multiple episode numbers
- Quality markers
- Release group
- Codec
- Source type
- Language indicators

Use a layered identification pipeline:

1. Inspect file and parent folder names.
2. Extract probable identifiers.
3. Classify movie, series, or personal video.
4. Search metadata providers.
5. Score candidate matches.
6. Assign high-confidence matches automatically.
7. Request user confirmation for ambiguous matches.
8. Preserve unresolved files for manual matching.

Store match confidence and provenance.

Never silently attach clearly incorrect metadata.

Provide a polished manual identification dialog that lets the user search for and select the correct movie or series.

Support locking a manually corrected match against future automatic overwrites.

---

# 8. IMDb and External Metadata Integration

Design a metadata provider abstraction rather than hardcoding a single external platform.

### Desired Metadata

For movies and series:

- Title
- Original title
- Release year
- Synopsis
- Genres
- Keywords/tags
- IMDb ID
- IMDb rating, when authorized and available
- Rating vote count
- Directors
- Writers
- Top-billed actors
- Character names
- Poster
- Backdrops
- Runtime
- Production information
- Release date
- Series season/episode information
- Collection relationships

### Providers

Research and propose an appropriate metadata provider architecture.

Consider:

- TMDB for rich title metadata and imagery.
- IMDb official data products where applicable and licensed.
- User-provided metadata.
- Local NFO metadata files.
- Additional legitimate providers through adapters.

Do not assume IMDb provides unrestricted free API access.

Do not scrape IMDb or bypass provider access restrictions.

Do not label ratings from other providers as IMDb ratings.

Store provider-specific IDs and rating provenance separately.

Use rate limiting, caching, retries, backoff, attribution, and configurable credentials where needed.

### Metadata Priority

A sensible hierarchy:

1. Explicit user overrides
2. Locally supplied metadata, where configured
3. Cached trusted metadata
4. External metadata providers
5. Filename-derived information

User corrections should survive future rescans and metadata refreshes.

### Languages

Prefer Greek metadata when the selected language is Greek and the provider offers it.

Fall back to English when localized content is unavailable.

Never translate proper names automatically without user consent.

---

# 9. File Naming and Organization

Implement a powerful but safe file normalization feature.

Preferred movie convention:

`Movie Title (Year).extension`

Example:

`Interstellar (2014).mkv`

Preferred series convention:

`Series Name - S01E01 - Episode Title.extension`

Example:

`Breaking Bad - S01E01 - Pilot.mkv`

Allow customizable templates.

### Required Features

- Detect nonstandard filenames.
- Suggest conventional filenames.
- Preview before/after names.
- Rename one file or multiple files.
- Detect filename collisions.
- Support bulk operations.
- Maintain database consistency.
- Preserve file extensions.
- Preserve important suffixes when configured.
- Handle Unicode and Greek filenames.
- Keep an operation history.
- Provide rollback when technically safe.

Do not rename files automatically without explicit user approval.

### Associated Files

When renaming a video, detect related assets:

- `.srt`
- `.ass`
- `.ssa`
- `.sub`
- `.nfo`
- Associated artwork

Offer coordinated renaming where appropriate.

Use transactional application state updates and a recoverable file operation journal.

Filesystem operations cannot be assumed to behave like database transactions.

Avoid moving or renaming currently playing files.

Clearly report partial failures and recovery steps.

---

# 10. Playback and External Players

Theama must support opening media with installed Windows video players.

Possible players:

- VLC
- MPC-HC
- MPC-BE
- mpv
- PotPlayer
- Windows default player

### Player Management

Provide a settings page that:

- Detects known installed players where possible.
- Allows manually adding executable paths.
- Sets a default player.
- Configures player launch arguments.
- Supports choosing a player per video.
- Validates configured executables.

Playback options:

- Play with default player
- Choose another player
- Open containing folder
- Copy file path
- View technical information

Use safe process spawning with argument arrays.

Never construct executable shell commands directly from untrusted filenames.

### Embedded Player

Evaluate a built-in player as a later phase.

Do not assume Electron's video capabilities support every container and codec.

If embedded playback is implemented, design seeking, subtitle selection, audio tracks, and HTTP range handling correctly.

### Playback Progress

Support watched/unwatched state and manual marking from the beginning.

Investigate player-specific integrations for resume position tracking.

Do not claim automatic progress tracking works universally across external players.

Use capability-based integrations and graceful fallbacks.

---

# 11. Subtitle Management

Subtitle management should be a first-class feature.

Support:

- Embedded subtitle track inspection
- External subtitle detection
- Language detection where possible
- Greek and English subtitle preferences
- Multiple subtitle files
- Forced subtitle indicators when detectable
- Subtitle association with videos
- Subtitle renaming
- Default subtitle selection
- Manual subtitle selection

Examples:

`Movie Name (2024).el.srt`

`Movie Name (2024).en.srt`

Provide a subtitle management interface on the media details page.

Allow manual association of mismatched subtitle files.

Do not overwrite user subtitle files during automated operations.

Design a future adapter interface for legitimate external subtitle providers, but do not make an online subtitle account a prerequisite.

---

# 12. Navigation and User Experience

**Navigation quality is the highest-priority frontend requirement.**

Theama must be designed as a cinematic experience rather than a traditional admin dashboard.

Use inspiration from Netflix's interaction patterns, but create an original visual identity and avoid copying proprietary branding or exact layouts.

### Main Navigation

Desktop navigation:

- Home
- Movies
- Series
- My Videos
- Search
- Collections
- Settings

Additional discovery destinations may appear within the main sections.

### Home Screen

Include curated sections such as:

- Continue Watching
- Recently Added
- Movies
- Series
- Your Collections
- Unwatched
- Recently Released
- Highly Rated
- Favorites

Every displayed title must correspond to the user's local library unless specifically identified as contextual metadata.

Sections with no content should disappear gracefully or use meaningful empty states.

### Poster Navigation

Create reusable, beautifully designed poster cards.

Each poster can display:

- Artwork
- Title
- Year
- Rating
- Watched status
- Progress indicator
- Optional collection badge

On hover or keyboard focus:

- Slight visual elevation or scale
- Quick details
- Play action
- More actions

Avoid excessive animations.

### Horizontal Browsing

Provide smooth horizontal content rails.

Requirements:

- Mouse wheel and trackpad compatibility
- Keyboard arrow navigation
- Proper focus visibility
- Smooth scrolling
- Accessible controls
- Optional visible scroll arrows
- Predictable focus restoration

Arrow keys must behave consistently between poster rows.

### Keyboard Navigation

Support at least:

- Arrow keys for navigation
- Enter for selection
- Escape for closing or going back
- Backspace or Alt+Left for navigation history, as appropriate
- Ctrl+F or `/` for search
- Space for relevant playback actions
- Tab and Shift+Tab for accessibility

Design an explicit focus management strategy.

Track selected items when users navigate between pages and return.

Avoid losing scroll positions unnecessarily.

### Responsive Design

Support:

- Large desktop displays
- Standard laptop screens
- Small desktop windows
- Tablets
- Mobile-width browser layouts

Desktop, mobile, and keyboard-driven navigation should share the same information architecture without requiring identical UI layouts.

Mobile considerations:

- Bottom navigation where appropriate
- Touch-friendly controls
- Responsive poster grids
- Swipeable content rails
- Optimized detail pages
- Accessible modals
- No hover-dependent essential actions

Mobile responsiveness does not imply that native Windows actions can run from a remote mobile browser.

Document which features are desktop-only and which could eventually be exposed through a secure LAN interface.

---

# 13. Visual Design System

Create a distinctive visual identity for Theama.

Design keywords:

- Artistic
- Greek-inspired
- Cinematic
- Editorial
- Minimal
- Timeless
- Refined
- Atmospheric

Avoid an overly generic Vuetify dashboard appearance.

### Dark Theme

Use a refined palette:

- Near-black or deep charcoal backgrounds
- Warm off-white typography
- Muted gold or bronze accents
- Soft gradients
- Subtle borders
- Elegant image treatments

### Light Theme

Use:

- Warm ivory or off-white backgrounds
- Charcoal typography
- Muted bronze accents
- Soft neutral surfaces
- Restrained shadowing

Both themes should look intentionally designed.

### Typography

Use elegant editorial typography for prominent headings while preserving highly readable fonts for UI elements.

Consider a tasteful pairing of a display serif and modern sans-serif.

Ensure Greek characters are fully supported.

### Motion

Implement subtle transitions:

- Poster focus
- Page navigation
- Hero image changes
- Content loading
- Detail overlays

Respect reduced-motion preferences.

### Visual Components

Design reusable components such as:

- TheamaAppShell
- TheamaSidebar
- TheamaBottomNavigation
- MediaPosterCard
- MediaLandscapeCard
- MediaCarousel
- FeaturedHero
- MediaDetailsHero
- MetadataChips
- CastCarousel
- CollectionCarousel
- SeasonSelector
- EpisodeCard
- ContinueWatchingCard
- ScanProgressIndicator
- EmptyLibraryState
- PlayerSelectionDialog
- MediaMatchingDialog
- RenamePreviewDialog
- SubtitleManager
- LibrarySourceManager

Use Vuetify as the foundation, but customize components when necessary to achieve a truly cinematic interface.

---

# 14. Search, Filters, and Discovery

Implement fast global search across all local library content.

Search fields:

- Title
- Original title
- Alternate titles
- Series title
- Episode title
- Actors
- Directors
- Genres
- Tags
- Collections
- Release year
- Descriptions, where useful

Prefer SQLite FTS5 or an equivalent local full-text indexing solution.

Include:

- Search suggestions
- Debounced input
- Keyboard navigation
- Recent searches stored locally
- Search result categories
- Graceful empty states

### Filtering

Support filters for:

- Movies / Series / My Videos
- Genre
- Year
- Rating
- Watched status
- Resolution
- Language
- Tags
- Collections
- Recently added

### Sorting

Support:

- Title
- Release date
- Date added
- Rating
- Runtime
- Recently watched
- File size, where useful

Use strongly typed filter objects and URL-serializable navigation state where appropriate.

Preserve filters and scroll positions when users open a title and return.

### Smart Collections

Consider automatically derived sections such as:

- Unwatched Movies
- Greek Cinema
- Science Fiction
- Recently Added
- Highly Rated
- 4K Movies
- Incomplete Series
- Movies by Director
- Movies Featuring an Actor

Only infer these collections from metadata actually available.

---

# 15. Localization

Theama must support:

- English (`en`)
- Greek (`el`)

Use Vue I18n.

Every user-facing string must be localizable.

Include:

- Navigation
- Buttons
- Dialogs
- Error messages
- Tooltips
- Settings
- File operations
- Search and filters
- Status messages
- Empty states

Support changing languages without restarting the application.

Persist language preferences.

Use appropriate date, number, and rating formatting.

Support correct Greek pluralization and Unicode search.

Metadata localization should be independent from UI localization where practical.

Design the architecture to allow additional languages later.

---

# 16. Settings

Create a polished, logically organized settings interface.

Sections:

### General
- Language
- Theme
- Startup behavior
- Window preferences

### Library
- Media folders
- Source categories
- Auto-scanning
- Excluded folders
- Supported extensions

### Metadata
- Provider configuration
- Preferred metadata language
- Automatic matching
- Artwork settings
- Cache controls
- Refresh metadata

### Playback
- Default player
- Configured external players
- Playback preferences
- Subtitle preferences

### File Organization
- Movie filename template
- Episode filename template
- Bulk rename preview
- Automatic suggestions

### Advanced
- Service status
- Database location
- Cache directory
- Logs
- Rescan
- Export configuration
- Backup and restore
- Diagnostics

Do not clutter the main browsing experience with advanced technical settings.

---

# 17. Database Design

Design a relational schema supporting at least:

- LibrarySource
- MediaTitle
- Movie
- Series
- Season
- Episode
- MediaFile
- FileIdentity
- MetadataProviderRecord
- Artwork
- Person
- Credit
- Genre
- Tag
- Collection
- CollectionMembership
- Subtitle
- PlaybackState
- ExternalPlayer
- MediaMatch
- UserOverride
- ScanJob
- FileOperation
- ApplicationSetting

These are conceptual entities, not mandatory one-to-one database tables.

Optimize and normalize the actual schema intelligently.

Separate the identity of a media title from the identity of a physical file.

One movie may have multiple local video files.

One video file may represent multiple episodes.

One title may have multiple metadata provider identifiers.

One movie may belong to multiple collections.

Preserve user edits when remote metadata changes.

Introduce schema migrations from the beginning.

Add indexes for common queries.

Document delete behavior, foreign keys, and referential integrity.

---

# 18. Error Handling and Reliability

Handle common scenarios gracefully:

- Media drive disconnected
- Missing file
- Folder permission denied
- Corrupted media
- External player not installed
- Metadata API unavailable
- Incorrect title match
- SQLite database locked
- Service unavailable
- Cache corruption
- Rename conflict
- Unexpected application shutdown
- Network unavailable

Use meaningful errors and nonintrusive notifications.

The interface should remain usable when external metadata services are offline.

Do not delete library records merely because their associated files are temporarily unavailable.

Implement appropriate retries, cancellation, job status tracking, and recovery.

---

# 19. Security and Privacy

Theama is a single-user, local-first application.

No sign-in, account, analytics tracking, or cloud synchronization is required.

However, no authentication does not mean ignoring local security.

Requirements:

- Secure localhost API access
- Avoid exposing unrestricted filesystem operations
- Validate and normalize file paths
- Prevent directory traversal
- Restrict arbitrary executable launching
- Avoid shell injection
- Safe Electron configuration
- Context isolation
- No unnecessary Node.js access in the renderer
- Narrow, typed IPC interfaces
- Secure handling of API credentials
- Explicit user approval for destructive filesystem actions
- External network requests only for enabled metadata features

Prefer storing service secrets and configuration using appropriate Windows-supported storage mechanisms.

Design a realistic local trust model covering the Electron renderer, service, and Windows account.

---

# 20. Performance

Performance is a product requirement.

Target smooth interaction even when the library contains:

- 5,000 movies
- 1,000 series
- Tens of thousands of episode files

Required strategies:

- Incremental scanning
- Background jobs
- Lazy-loaded artwork
- Thumbnail caching
- Virtualized long lists
- Indexed search
- Pagination or cursor-based loading
- Efficient database queries
- Bounded worker concurrency
- Cancelable expensive operations
- Avoiding unnecessary component rerenders

Measure important UI and backend operations.

Do not load the entire media library with all metadata and images into memory on startup.

---

# 21. Installer and Deployment

Produce a Windows installer that installs:

1. Theama desktop application
2. Theama background service
3. Required application assets
4. Appropriate application data directories

The installer should:

- Install and register the service.
- Start it safely.
- Launch Theama.
- Support updates.
- Preserve data during upgrades.
- Remove service registration on uninstall.
- Offer clear choices for preserving or deleting cached application data.

Investigate the permissions necessary to install a Windows Service.

Do not silently assume the application can install services without elevation.

Document first-run behavior and possible permission prompts.

Provide a development workflow where the backend can run as a normal foreground Node.js process without requiring service installation.

---

# 22. Testing

Include automated tests appropriate to the architecture.

### Unit Tests

Especially for:

- Filename parsing
- Episode detection
- Metadata matching
- Collection relationships
- Filename normalization
- Path safety
- Search filter logic

### Integration Tests

For:

- Folder scanning
- Database persistence
- API endpoints
- Metadata adapters
- Scan recovery
- File rename workflows
- Subtitle associations

### End-to-End Tests

Cover:

- First launch
- Add library folder
- Scan progress
- Browse movies
- Open movie details
- Browse seasons
- Identify missing episodes
- Search
- Rename preview and confirmation
- Change language
- Toggle theme
- Launch external player

Test both Greek and English interfaces.

Test dark and light themes.

Test desktop and mobile viewport layouts.

---

# 23. Implementation Milestones

Implement Theama incrementally.

## Phase 1 — Foundation

- Monorepo structure
- TypeScript configuration
- Electron shell
- Vue/Vuetify frontend
- Node.js backend
- Local API
- SQLite database
- Typed shared contracts
- English/Greek localization
- Theme infrastructure

Acceptance criteria: Theama opens as a desktop application, communicates with the backend, and displays a functional application shell.

## Phase 2 — Media Discovery

- Add/remove folders
- Scan video files
- Persist library entries
- Detect file changes
- Extract technical metadata
- Display scan progress
- Build Movies, Series, and My Videos sections

Acceptance criteria: Users can add real folders and browse detected files without external metadata.

## Phase 3 — Cinematic UI

- Poster cards
- Content rails
- Details pages
- Responsive layout
- Keyboard navigation
- Search
- Navigation history
- Empty states
- Virtual scrolling where needed

Acceptance criteria: The app is pleasant and efficient to browse, with mocked or locally generated artwork where metadata is unavailable.

## Phase 4 — Metadata Integration

- Provider adapters
- Title matching
- Artwork caching
- Descriptions
- Genres
- Ratings
- Cast
- Manual correction
- Metadata updates

Acceptance criteria: Recognized local movies and series display rich information, while unmatched files remain manageable.

## Phase 5 — Series and Collections

- Series/seasons/episodes
- Missing episode detection
- Episode matching
- Movie franchises
- Collection relationships
- Continue watching UI

Acceptance criteria: Episodic content is accurately grouped and missing local episodes are clearly identified.

## Phase 6 — Playback and File Management

- External player configuration
- Open containing folder
- Subtitles
- Filename normalization
- Bulk rename previews
- Safe file operation journaling
- Playback state capabilities

Acceptance criteria: Users can safely open and manage real media without losing files or metadata.

## Phase 7 — Production Readiness

- Windows Service deployment
- Installer
- Update handling
- Backup/restore
- Performance optimization
- Automated tests
- Error reporting
- Documentation

Acceptance criteria: A clean Windows installation can install, run, update, and uninstall Theama reliably.

---

# 24. Deliverables

Before implementing code, provide the following:

1. **Product Requirements Document (PRD)** defining scope, UX priorities, and functional requirements.
2. **Architecture Decision Records (ADRs)** explaining key technical decisions.
3. **High-level architecture diagram** showing Electron, Vue, local API, Windows Service, SQLite, metadata providers, and filesystem integrations.
4. **Monorepo folder structure** with clear package responsibilities.
5. **Database schema** describing entities, keys, relations, and indexes.
6. **API design** with main endpoints and typed payloads.
7. **Navigation map** including desktop and mobile patterns.
8. **Screen specifications** for Home, Movies, Series, My Videos, Search, Details, Collections, and Settings.
9. **Design system** covering typography, color, spacing, focus, animation, and theme variants.
10. **Metadata matching algorithm** including ambiguity handling.
11. **Media scanning workflow** including filesystem events and failure recovery.
12. **Implementation roadmap** organized by dependencies and milestones.
13. **Testing strategy** and acceptance criteria.
14. **Risks and trade-offs**, especially around Windows Services, player integration, and metadata licensing.

After presenting the plan, proceed with implementing Phase 1.

Create actual working project files rather than merely providing pseudocode.

Keep the application runnable after each phase.

Use strict typing and maintain a clear separation between frontend, desktop shell, backend, and shared domain logic.

Do not introduce unnecessary infrastructure such as Docker, Kubernetes, cloud services, Redis, external databases, or authentication.

Use reliable, currently supported dependencies and verify compatibility.

---

# 25. Working Rules

Follow these rules throughout development:

- Prioritize working software over unnecessary abstractions.
- Prefer small, cohesive modules.
- Avoid oversized Vue components.
- Keep backend domain logic independent of Electron.
- Make every filesystem modification explicit and recoverable.
- Provide clear loading, empty, error, and success states.
- Do not fabricate metadata.
- Never overwrite user edits silently.
- Keep Greek/English localization complete.
- Treat accessibility and keyboard navigation as first-class requirements.
- Preserve application responsiveness during scanning.
- Do not hide significant limitations behind simulated functionality.
- Use realistic mock data only when clearly labeled during development.
- Write tests for critical parsing and filesystem operations.
- Document assumptions and meaningful architectural trade-offs.
- Favor functional core workflows over superficial polish, while maintaining a coherent design system.

When uncertain about implementation details, choose a reasonable approach, document the decision, and proceed.

---

# 26. Definition of Success

A successful initial release allows a user to:

1. Install and open Theama.exe.
2. Add their existing movie, TV series, and personal video folders.
3. Automatically discover the media without manual file-by-file import.
4. See a beautiful poster-based library.
5. Navigate quickly using mouse, keyboard, or touch.
6. Open movie and series details.
7. Browse TV shows by season and episode.
8. Identify missing episodes.
9. Explore movie sequels and collections.
10. Search titles, genres, actors, and tags.
11. Open a video using a configured local player.
12. Open the video's containing folder.
13. Manage subtitles and local metadata.
14. Preview and safely rename incorrectly named files.
15. Change between Greek and English.
16. Switch between beautiful dark and light themes.
17. Continue using the local library without internet connectivity.
18. Close the application while the background service continues managing the library.

**Theama must feel like a personal cinematic archive, not simply a graphical wrapper around a filesystem.**

---

# 27. Start Here

Begin by producing:

**Part A — Product vision and scope**

Clearly separate MVP, post-MVP, and optional future features.

**Part B — Technical architecture**

Propose the complete system architecture and explain any changes you recommend to the stack.

**Part C — Database and domain model**

Pay particular attention to movies, series, episodes, multiple file versions, metadata providers, collections, and user overrides.

**Part D — UX and navigation**

Define a navigation-first experience with screen layouts, focus behavior, browsing workflows, keyboard controls, responsive states, and a distinctive Theama visual identity.

**Part E — Implementation roadmap**

Create an actionable, dependency-ordered set of milestones, tasks, and acceptance criteria.

**Part F — Implementation**

Begin implementing Phase 1 using real files, configuration, code, and tests.

Do not attempt to implement all features in one giant code generation pass.

Build incrementally, validate each stage, and preserve a runnable application.

The ultimate objective is a polished, maintainable, reliable, and visually distinctive personal media platform named **THEAMA**.


Iclude icon and logo creation and handle missing videos(e.g. from external source that some times be abcent