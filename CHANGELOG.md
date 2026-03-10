# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.8.0] - 2026-03-10

### Added

- **Search overhaul** — search now queries ALL Nintendo Switch games (not just discounted) using Solr eDisMax with multilingual phrase boost across `title`, `title_extras_txt`, and `title_master_s`
- **"Not on sale" state** — games found via search that aren't discounted show with gray badge, muted styling, and full price with "Watch for price drop" CTA
- **ntdeals.net scraper** (`scripts/scrape-ntdeals.py`) — new curated source using cloudscraper for Cloudflare bypass, extracts Metacritic scores and deal ratings across 3 sort modes
- **Multi-source curated display** — curated entries now show source attribution (NintendoLife vs NT Deals) with distinct color schemes and Metacritic score badges
- **CuratedEntry extended** — new optional fields: `source`, `metacritic_score`, `deal_rating`, `discount_pct`, `days_remaining`

### Fixed

- **177 missing games restored** — removed `digital_version_b:true` filter from Solr query; games like Ori and the Blind Forest, Sifu, Danganronpa, Core Keeper now appear correctly
- **Search crash on non-sale games** — added null checks for `price_discounted_f`, `price_discount_percentage_f`, and `price_regular_f` in GameCard, GameDetailModal, and sort functions
- **Search relevancy** — switched from raw Solr `q` to eDisMax with phrase boost; "Hollow Knight" now returns Hollow Knight as top result instead of "Hollow Cocoon"

### Changed

- **Search debounce** — increased from 300ms to 500ms for broader search queries
- **Search UX** — tabs hidden during search, "Searching all Nintendo Switch games" banner shown, result count in header

## [1.7.3] - 2026-03-09

### Added

- **Composite shovelware filter** — scores games on Steam votes/score, publisher quality, tag ratio, price, and Nintendo categories. Games scoring ≥6 moved to "Low Quality" tab (164 games)
- **Steam tag filter UI** — collapsible panel with 60 most common Steam tags, click to exclude from Deals
- **Improved Steam matching** — suffix stripping (Legacy, XL, DX, Complete Edition, etc.), multi-pass search, Reviews API fallback. Match rate 40% → 55% (1016 → 1389 games)

### Changed

- **Erotic content tag filter refined** — removed "Sexual Content" (false positives on horror games), kept Hentai/NSFW/Dating Sim/Otome (54 → 60+ games filtered)

## [1.7.2] - 2026-03-08

### Added

- **SteamSpy tag-based erotic content filtering** — fetches community tags (up to 15) per game from SteamSpy API during steam-backfill
- **`hasBlockedSteamTags()` filter** — blocks games tagged with Hentai, NSFW, Dating Sim, or Otome
- **`--tags-only` mode** in steam-backfill.py for backfilling tags on already-matched entries

### Changed

- **Blocked tag list refined** — removed "Sexual Content" (too broad, false positives on horror games like Sagebrush, Despotism 3k). Kept Hentai, NSFW, Dating Sim, Otome
- **Rate limit increased** — SteamSpy API calls now use 1s delay (was 0.5s) to avoid rate limiting

### Stats

- 1016 games with Steam data, 960 now have SteamSpy tags
- 54 games blocked by erotic/dating tags (Sweetest Monster, Prison Princess, Fantasy Tavern Sextet series, etc.)

## [1.7.1] - 2026-03-08

### Fixed

- **Steam backfill script** — rewrote to use Steam Store Search API (bulk GetAppList v2 is down), multi-strategy title matching now achieves ~60% hit rate
- **Curated scraper** — proper `<h3>` parsing from NintendoLife, fs_id matching via Solr API, review text extraction (48/50 games matched)
- **GameCard props** — `steam` and `isCurated` props now passed from DealsClient (badges render correctly)
- **Curated title matching** — uses fs_id-keyed `CuratedMap` instead of brittle `title.includes()` on string array

### Changed

- **Curated data structure** — from `string[]` to `Record<fs_id, CuratedEntry>` with title, review text, source URL, and rank
- **Curated games pinned to top** — always appear above sorted games in Deals tab, sorted by NintendoLife rank
- **Detail modal** — shows NintendoLife review text for curated games in a yellow callout box
- **Confidence threshold** — raised from 10 to 100 (sum of IGDB + Steam votes)
- **`normalizeTitle()` utility** — diacritic-stripped, case-insensitive comparison for consistent matching

## [1.7.0] - 2026-03-08

### Added

- **Steam Rating Integration** — Games now show Steam User Review score (e.g. "95% (3.7k)") as a second opinion. Used in "Best Value" sorting.
- **Curated Deals** — Scrapes NintendoLife "Best of" lists. Curated games get a "🏆 Curated" badge and score boost.
- **"Few Reviews" Tab** — Games with < 10 reviews are moved to a separate "Few Reviews" tab to declutter the main feed.
- **Enhanced Filtering** — "Pretty Girls", "Mahjong", "Solitaire", "Jigsaw Puzzle" titles are now blocked.

### Changed

- **Tiered sorting** — games with 10+ reviews (confident) shown first in rating/value sorts; games with fewer reviews appear after; unrated games last
- **Bayesian m raised to 10** — games need ~10+ reviews to meaningfully diverge from global mean (was m=5)
- **Default sort changed to Best Value** — combines 70% Bayesian score + 30% price score (cheaper = better)
- **Value sort reordered** — "Best Value ★/€" is now first option in dropdown, "Top Rated ★" second
- **Expanded dating filter** — catches Date Z, Date Everything, boyfriend/girlfriend/otome/waifu/harem titles

## [1.6.0] - 2026-03-08

### Changed

- **Tiered sorting** — games with 10+ reviews (confident) shown first in rating/value sorts; games with fewer reviews appear after; unrated games last
- **Bayesian m raised to 10** — games need ~10+ reviews to meaningfully diverge from global mean (was m=5)
- **Default sort changed to Best Value** — combines 70% Bayesian score + 30% price score (cheaper = better)
- **Value sort reordered** — "Best Value ★/€" is now first option in dropdown, "Top Rated ★" second
- **Expanded dating filter** — catches Date Z, Date Everything, boyfriend/girlfriend/otome/waifu/harem titles

## [1.5.0] - 2026-03-08

### Changed

- **Rating sort now covers ALL games** — fetches entire 2,504-game catalog (paginating through Solr's 1000-row cap) instead of sorting only the 48 loaded games
- **Bayesian average scoring** — ratings weighted by review count using formula `B = (v/(v+m))×R + (m/(v+m))×C` (m=5, C=global mean ~68.8), dampening outlier ratings from few reviews
- **Value sort** — now uses Bayesian score / price ratio for fair ranking
- **Rating badges** — show Bayesian-adjusted score with review count (e.g., "★ 89 · 1376") and tooltip with raw vs adjusted values
- **Virtual scroll for rating sorts** — renders 48 games at a time from full sorted array, loads more on scroll

## [1.4.0] - 2026-03-08

### Added

- **Infinite scroll** — replaces "Load more" button with IntersectionObserver auto-loading across all tabs
- **"Thinking about it" tab** — bookmark games to reconsider later; games hidden from Deals tab while in list
- **Rating review count** — shown in parentheses on rating badges (e.g., "🎬 85 (12)")
- **Low review warning** — games with ≤1 user review show ⚠ orange warning badge

### Changed

- **Trailer auto-play** — detail modal opens with YouTube trailer first (was screenshots), toggle tabs moved below video area
- **Deal counter** — header shows filtered main-page count (after hiding/watching/thinking), not raw API total
- **Sort order** — rating/value sorts now penalize games with ≤1 user review (sorted after reliable ratings)
- **IGDB matching** — uses `title_master_s` (English title) from Nintendo API for better matching; 28 new matches (2,253→2,281, 91.1% coverage)
- Tabs expanded: Deals | Collections | Sports | Thinking | Hidden | Watched

## [1.3.0] - 2026-03-07

### Added

- **Media Gallery Modal** — click any game tile to open a fullscreen detail modal with:
  - Screenshot carousel with navigation arrows and thumbnail strip
  - YouTube trailer embed (toggle between screenshots and trailer)
  - Game info panel (title, publisher, price, rating, description)
  - External links: Nintendo eShop, IGDB, YouTube
- **Media indicators** on game tiles — camera icon with screenshot count, play icon for trailer availability
- **IGDB link** — purple IGDB button on game cards for games with IGDB data
- **Media storage** — `media.json` in Vercel Blob with screenshots/videos per game
- `/api/media` endpoint — GET (public) and PUT (auth) for media data
- `lib/media-storage.ts` — Vercel Blob CRUD for media data
- `components/GameDetailModal.tsx` — full-featured detail modal component
- `scripts/media-backfill.py` — standalone backfill script for Nintendo page scraping + IGDB fallback

### Changed

- Game tiles now respond to clicks (open detail modal) with hover brightness effect
- Nintendo screenshots used as primary media source (official HD), IGDB as fallback
- YouTube trailers from IGDB embedded directly (Limelight/Cloudinary videos from Nintendo not embeddable)
- Middleware updated to allow `/api/media` through without auth cookie

## [1.2.1] - 2026-03-07

### Fixed

- **Blob storage reads failing** — switched from `head()` + manual `fetch()` to SDK `get()` with `access: 'private'` for both `ratings-storage.ts` and `blob-storage.ts`, fixing intermittent 0-result reads
- **Ratings API caching** — added `Cache-Control: no-store, max-age=0` header to GET `/api/ratings` to prevent Vercel edge caching stale data
- **RATINGS_API_KEY env var** — re-set on Vercel without trailing newline that was causing 401 Unauthorized on PUT

### Changed

- n8n workflow (`VHlYChVKtFofIVdp`) now includes a Manual Trigger node alongside the Daily 6am schedule for on-demand testing

## [1.2.0] - 2026-03-07

### Added

- **IGDB ratings** on game cards — critic, user, and combined scores displayed as color-coded badges (green >75, yellow 50-75, red <50)
- **Sort by Rating** — orders games by IGDB combined score (descending)
- **Sort by Best Value** — price ascending with rating as tiebreaker (cheapest highly-rated games first)
- **Collections tab** — bundles, collections, and multi-game packs in their own tab (queried server-side from Nintendo Solr API)
- **Sports tab** — sports category games in their own tab (queried server-side)
- **< 2€ watch button** alongside existing < 5€ and < 10€ thresholds
- **Content filtering** — hentai/dating titles auto-blocked from all views
- **/api/ratings** endpoint — GET (public) and PUT (auth via `x-api-key`) for n8n workflow
- **n8n workflow** (`VHlYChVKtFofIVdp`) — daily cron for IGDB rating lookup and Telegram price alerts
- **Telegram bot** (`@nintendo_deals2_bot`) — sends price alerts when watched games drop below threshold
- `lib/filters.ts` — game classification engine (deals/collections/sports/blocked)
- `lib/ratings-storage.ts` — Vercel Blob CRUD for `ratings.json`

### Changed

- Header deal counter now shows only main-tab visible games (excluding collections, sports, hidden, watched)
- Tabs expanded from 3 to 5: Deals | Collections | Sports | Hidden | Watched
- Tab bar is horizontally scrollable on mobile
- `Preferences.watchGames.threshold` type expanded from `5 | 10` to `2 | 5 | 10`
- Middleware now allows `/api/ratings` and `/api/preferences` through without auth cookie (needed for n8n)
- Collections/Sports fetch from Nintendo Solr API with tab-specific query filters (not client-side classification)

## [1.1.0] - 2026-03-07

### Fixed

- **Stale game data**: Nintendo API responses were cached by Vercel edge — switched to `cache: 'no-store'` and `dynamic = 'force-dynamic'` to always fetch fresh data
- **Hidden/watched games not persisting on reload**: Vercel Blob overwrites take 15–42s (avg 26s) to become readable. The PATCH handler's read→modify→write pattern caused rapid successive actions to overwrite each other with stale data

### Changed

- Preferences API changed from PATCH (read-modify-write) to PUT (write-only) — client sends full preferences state, server writes directly to Blob without reading first
- Client React state is authoritative during a session; Blob is only read on page load (always >30s after last action, so reads are consistent)
- Blob reads use `head()` to discover URL, then direct `fetch()` with timestamp cache-bust and Authorization header

## [1.0.0] - 2026-03-06

### Added

- Initial release of Nintendo Deals tracker
- Password-protected login with cookie-based auth
- Live game data from Nintendo Europe Solr API (Spanish market, EUR prices)
- Game cards with cover images, titles, publishers, descriptions, prices, and discount badges
- **Hide** button to permanently remove games from the Deals view
- **< 5 €** and **< 10 €** watch buttons — hides game until price drops below threshold
- **Tabs**: Deals / Hidden / Watched for managing preferences
- Hidden tab shows "Unhide" button to restore games
- Watched tab shows watched games with info banner
- Full-text search across game titles and descriptions
- Sort by: Popularity, Discount %, Price (low/high), Title (A-Z)
- Spanish → English category translation (Action, Adventure, RPG, etc.)
- 3-line description excerpts with line clamping
- Responsive 1/2/3 column grid (mobile-first)
- Vercel Blob storage for user preferences (private store)
- Vercel deployment with security headers (fra1 region)
- Load more pagination (48 games per page)
- Optimistic UI updates for hide/watch actions
- Logout functionality
