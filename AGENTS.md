# Nintendo Deals — AI Agent Context

**Public repository — NEVER commit secrets, tokens, or passwords.**

## Overview

Personal Nintendo eShop deal tracker. Displays Switch games on sale in the Spanish market (EUR prices), with hide/watch/search/sort features, IGDB ratings, content filtering, and Telegram price alerts. Single-user, password-protected.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Storage | Vercel Blob (private store) |
| Data source | Nintendo Europe Solr API |
| Ratings | IGDB API (via GitHub Actions daily worker) |
| Media | Nintendo pages + IGDB fallback |
| Alerts | Telegram bot (via GitHub Actions daily worker) |
| Hosting | Vercel (fra1 region) |
| Auth | Cookie-based password gate |
| Automation | GitHub Actions daily worker + Vercel Telegram webhook |

## Quick Start

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Key Directories

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router pages and API routes |
| `app/api/auth/` | Login/logout API (POST/DELETE) |
| `app/api/games/` | Nintendo API proxy with search/sort/pagination/tab filters |
| `app/api/preferences/` | Blob-backed preferences CRUD |
| `app/api/preferences/actions/` | Atomic preference mutations for automations (`hide`, `watch`) |
| `app/api/telegram/` | Telegram callback webhook and digest-message updates |
| `app/api/ratings/` | Blob-backed ratings CRUD (GET public, PUT auth via x-api-key) |
| `app/api/media/` | Blob-backed media CRUD (GET public, PUT auth via x-api-key) |
| `app/login/` | Password login page |
| `components/` | React components (GameCard, GameDetailModal, DealsClient, SearchBar, SortSelect) |
| `lib/` | Shared utilities (types, API client, blob/ratings/media storage, filters) |
| `scripts/` | Automation scripts (media-backfill.py) |

## Key Files

| File | Purpose |
|------|---------|
| `middleware.ts` | Auth middleware — redirects unauthenticated users to /login (bypasses /api/ratings, /api/preferences, /api/media, /api/steam, /api/curated) |
| `lib/nintendo-api.ts` | Solr query builder with base filters, sort mapping, and tab-specific queries |
| `lib/blob-storage.ts` | Vercel Blob read/write for preferences.json |
| `lib/ratings-storage.ts` | Vercel Blob read/write for ratings.json |
| `lib/filters.ts` | Game classification: blocked (hentai/dating), collections, sports, deals |
| `lib/media-storage.ts` | Vercel Blob read/write for media.json |
| `lib/types.ts` | TypeScript interfaces (NintendoGame, Preferences, GameRating, GameMedia, MediaMap, etc.) |
| `components/GameCard.tsx` | Game card with hide/watch buttons, rating badges, media indicators, IGDB link |
| `components/GameDetailModal.tsx` | Fullscreen detail modal with screenshot carousel, YouTube embed, game info |
| `components/DealsClient.tsx` | Main page: 5 tabs, grid, search, sort, optimistic updates, ratings/media integration |
| `scripts/media-backfill.py` | Backfill media for all games: Nintendo scraping + IGDB fallback, incremental saves |
| `automation/` | One-shot daily ratings, price-alert, and curated-digest worker |
| `.github/workflows/nintendo-deals-daily.yml` | DST-safe daily worker schedule and manual replay |
| `vercel.json` | Vercel config: region, headers, build settings |

## Content Filtering

Games are classified in `lib/filters.ts`:
- **Blocked**: Titles matching `/\b(hentai)\b/i` or dating context patterns — never shown to user
- **Collections**: Titles matching `/\b(collection|bundle|\d+\s*in\s*1|mega\s+pack)\b/i` — shown in Collections tab
- **Sports**: Games with category `Deportes` — shown in Sports tab
- **Deals**: Everything else — shown in main Deals tab

Collections and Sports tabs fetch directly from Nintendo Solr API with tab-specific query filters (not client-side filtering of the main batch).

## IGDB Ratings

- **Storage**: `ratings.json` in Vercel Blob (alongside `preferences.json`)
- **Source**: IGDB API (free, Twitch OAuth, 4 req/sec limit)
- **Update**: Daily GitHub Actions worker
- **Matching**: Title normalization + Levenshtein distance, ≥70% confidence threshold
- **Display**: Critic badge (🎬), User badge (👤), Combined badge (⭐) — color-coded green/yellow/red
- **Sort**: "Rating ★" (by combined score) and "Best Value" (price + rating)
- **Batch**: 100 unrated games per cron run

## Media Gallery

- **Storage**: `media.json` in Vercel Blob
- **Primary**: Nintendo game page scraping (`_gItems.push` pattern) — official HD screenshots
- **Fallback**: IGDB `/screenshots` + `/game_videos` endpoints
- **Videos**: YouTube trailers from IGDB (Nintendo Limelight videos not embeddable — DNS/service issues)
- **Frontend**: Click game tile → detail modal with screenshot carousel + YouTube embed + IGDB link
- **Indicators**: Game tiles show screenshot count and trailer availability badges
- **Backfill**: `scripts/media-backfill.py` — processes all games, incremental saves every 50 games
- **Coverage**: ~99% of games have screenshots, ~71% have YouTube trailers

## Telegram Alerts

- **Bot**: `@nintendo_deals2_bot` (create via @BotFather)
- **Trigger**: Daily GitHub Actions worker checks watched games against each configured threshold (`2€`, `5€`, `10€`)
- **Format**: Game title, price, discount %, threshold, Nintendo URL
- **Telegram callbacks**: Vercel `POST /api/telegram/webhook` validates the configured chat/user, applies atomic preference actions, and edits the original digest message.
- **GitHub Actions**: `.github/workflows/nintendo-deals-daily.yml` runs the one-shot worker with `workflow_dispatch` for replay and a concurrency lock to prevent overlapping writes.

## Recovered n8n Lineage and Replacement

The original n8n graph was not recovered. Historical IDs are retained only for forensic comparison:

- `IQAxU4FrfJbU97N4` — previous daily ratings/alerts/digest workflow
- `9MvabizSCzYJCVwn` — previous Telegram callback workflow
- `VHlYChVKtFofIVdp` — superseded 06:00 workflow lineage

The replacement is:

- GitHub Actions runs `python automation/run_daily.py` at 10:00 Europe/Madrid.
- Vercel handles Telegram `callback_query` updates at `/api/telegram/webhook`.
- Telegram uses webhook delivery only; no polling consumer is allowed.

**Required GitHub Actions secrets:**
- `TWITCH_CLIENT_ID` — Twitch app Client ID for IGDB API
- `TWITCH_CLIENT_SECRET` — Twitch app Client Secret
- `RATINGS_API_KEY` — shared secret for PUT /api/ratings
- `NINTENDO_DEALS_BASE_URL` — app base URL for deep links
- `TELEGRAM_BOT_TOKEN` — bot token from @BotFather
- `TELEGRAM_CHAT_ID` — destination chat for outbound alerts/digest

**Required Vercel environment variables:**
- `TELEGRAM_BOT_TOKEN` — bot token used by the webhook for callback responses
- `TELEGRAM_WEBHOOK_SECRET` — Telegram webhook secret header value
- `NINTENDO_TELEGRAM_CHAT_ID` — allowed Telegram chat ID
- `NINTENDO_TELEGRAM_USER_ID` — optional allowed Telegram user ID

## Nintendo Solr API

- **Endpoint**: `https://searching.nintendo-europe.com/es/select`
- **Locale**: `/es/` for Spanish market (EUR prices, Spanish descriptions)
- **Base filters**: Switch games, on sale, 0–14.99 €, English language available, digital-only
- **Tab queries**: Collections use Solr `q` with OR terms; Sports use `fq` category filter
- **Search**: Uses Solr `q` parameter for full-text search
- **Sort options**: popularity, discount %, price, title (rating/value sorted client-side)

## Deployment (Vercel)

- **Platform**: Vercel
- **Region**: fra1 (Frankfurt)
- **Auto-deploy**: OFF — use `npx vercel --prod --yes` to deploy
- **URL**: https://nintendo-deals.vercel.app
- **Env vars**: `ACCESS_PASSWORD`, `nintendo_READ_WRITE_TOKEN` (Blob), `RATINGS_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NINTENDO_TELEGRAM_CHAT_ID`

## Conventions

- UI language: English (categories translated from Spanish via `CAT_ES_TO_EN` map)
- Prices: EUR (Spanish eShop)
- Descriptions: Spanish (from ES Solr endpoint — trade-off for correct prices)
- Preferences stored in Vercel Blob (private store, single `preferences.json` file)
- Ratings stored in Vercel Blob (private store, single `ratings.json` file)
- Media stored in Vercel Blob (private store, single `media.json` file)
- Blob has ~2s eventual consistency on overwrites; reads use direct URL fetch with cache-busting
- GitHub Actions uses a concurrency group so whole-map ratings writes cannot overlap
- Optimistic updates: Client updates state immediately, persists to Blob in background
- Watch thresholds: 2€, 5€, 10€
- "Thinking about it" list: games bookmarked for later, hidden from Deals tab
- Tabs: Deals | Collections | Sports | Thinking | Hidden | Watched
- Infinite scroll via IntersectionObserver (no "Load more" button)
- Header deal counter shows filtered main-page count (excludes hidden, watched, thinking)
- Rating badges show review count; ≤1 user review shows ⚠ warning
- Sort by rating/value penalizes games with ≤1 user review
- IGDB matching uses `title_master_s` from Nintendo API (English titles) for better coverage
- Rating/value sorts fetch ALL games (paginating Solr's 1000-row cap) for true full-catalog sorting
- Bayesian average: `B = (v/(v+m))×R + (m/(v+m))×C` where m=10, C=global mean (~68.8), dampens low-review outliers
- Tiered sorting: confident (100+ total reviews) first, then low-review, then unrated
- Confidence threshold: 100 total votes (sum of IGDB rating_count + Steam votes)
- Default sort: Best Value (70% Bayesian + 30% price score)
- Steam Ratings: fetched via Steam Store Search API (`scripts/steam-backfill.py`), stored in `steam_ratings.json`, ~60% match rate
- Curated Deals: scraped from NintendoLife (`scripts/scrape-curated.py`), stored as `CuratedMap` in `curated.json` (keyed by fs_id, includes review text, rank, source URL). 48/50 top games matched. Curated games pinned to top of Deals tab.
- "Few Reviews" tab: isolates games with < 100 total reviews (IGDB + Steam combined)
- `lib/sort-utils.ts`: `bayesianScore()`, `computeGlobalMean()`, `normalizeTitle()` utilities
- Virtual scroll for rating/value sorts: 48 at a time from full sorted array in memory

## Critical Rules

1. **No secrets in code** — all sensitive values via environment variables
2. **No force push** — public repo
3. **Verify builds** — `npx tsc --noEmit` before deploying
4. **Test API changes** — `curl` against deployed endpoints
5. **Categories**: Always add new ES→EN translations to `CAT_ES_TO_EN` in GameCard.tsx
6. **Ratings/Media/Preferences Actions API**: automation writes require `x-api-key` header matching `RATINGS_API_KEY` env var
7. **Telegram**: Use webhook delivery only; never add a polling consumer beside `/api/telegram/webhook`
8. **GitHub Actions**: Secrets are passed through the job environment and never written to workflow YAML or logs

## See Also

- [README.md](README.md) — Setup and usage
- [CHANGELOG.md](CHANGELOG.md) — Version history
