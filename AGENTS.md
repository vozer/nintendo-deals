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
| Ratings | IGDB API (via n8n daily cron) |
| Alerts | Telegram bot (via n8n daily cron) |
| Hosting | Vercel (fra1 region) |
| Auth | Cookie-based password gate |
| Automation | n8n on Raspberry Pi |

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
| `app/api/ratings/` | Blob-backed ratings CRUD (GET public, PUT auth via x-api-key) |
| `app/login/` | Password login page |
| `components/` | React components (GameCard, DealsClient, SearchBar, SortSelect) |
| `lib/` | Shared utilities (types, API client, blob storage, ratings, filters) |

## Key Files

| File | Purpose |
|------|---------|
| `middleware.ts` | Auth middleware — redirects unauthenticated users to /login (bypasses /api/ratings, /api/preferences) |
| `lib/nintendo-api.ts` | Solr query builder with base filters, sort mapping, and tab-specific queries |
| `lib/blob-storage.ts` | Vercel Blob read/write for preferences.json |
| `lib/ratings-storage.ts` | Vercel Blob read/write for ratings.json |
| `lib/filters.ts` | Game classification: blocked (hentai/dating), collections, sports, deals |
| `lib/types.ts` | TypeScript interfaces (NintendoGame, Preferences, GameRating, RatingsMap, etc.) |
| `components/GameCard.tsx` | Game card with hide/watch buttons, rating badges, and category translation |
| `components/DealsClient.tsx` | Main page: 5 tabs, grid, search, sort, optimistic updates, ratings integration |
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
- **Update**: Daily n8n cron workflow on Raspberry Pi
- **Matching**: Title normalization + Levenshtein distance, ≥70% confidence threshold
- **Display**: Critic badge (🎬), User badge (👤), Combined badge (⭐) — color-coded green/yellow/red
- **Sort**: "Rating ★" (by combined score) and "Best Value" (price + rating)
- **Batch**: 100 unrated games per cron run

## Telegram Alerts

- **Bot**: `@nintendo_deals_bot` (create via @BotFather)
- **Trigger**: Daily n8n cron checks watched games with < 2€ threshold
- **Format**: Game title, price, discount %, threshold, Nintendo URL
- **n8n Workflow**: Same as IGDB ratings (`VHlYChVKtFofIVdp`)

## n8n Workflow

| Workflow | ID | Purpose |
|----------|-----|---------|
| Nintendo Deals - IGDB Ratings & Price Alerts | `VHlYChVKtFofIVdp` | Daily 6am: fetch IGDB ratings for unrated games, check price alerts, send Telegram |

**Required n8n environment variables:**
- `TWITCH_CLIENT_ID` — Twitch app Client ID for IGDB API
- `TWITCH_CLIENT_SECRET` — Twitch app Client Secret
- `RATINGS_API_KEY` — shared secret for PUT /api/ratings
- `NINTENDO_TELEGRAM_CHAT_ID` — your Telegram chat ID

**Required n8n credential:**
- `Nintendo Deals Bot` (type: `telegramApi`) — bot token from @BotFather

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
- **Env vars**: `ACCESS_PASSWORD`, `nintendo_READ_WRITE_TOKEN` (Blob), `RATINGS_API_KEY`

## Conventions

- UI language: English (categories translated from Spanish via `CAT_ES_TO_EN` map)
- Prices: EUR (Spanish eShop)
- Descriptions: Spanish (from ES Solr endpoint — trade-off for correct prices)
- Preferences stored in Vercel Blob (private store, single `preferences.json` file)
- Ratings stored in Vercel Blob (private store, single `ratings.json` file)
- Blob has ~2s eventual consistency on overwrites; reads use direct URL fetch with cache-busting
- Optimistic updates: Client updates state immediately, persists to Blob in background
- Watch thresholds: 2€, 5€, 10€

## Critical Rules

1. **No secrets in code** — all sensitive values via environment variables
2. **No force push** — public repo
3. **Verify builds** — `npx tsc --noEmit` before deploying
4. **Test API changes** — `curl` against deployed endpoints
5. **Categories**: Always add new ES→EN translations to `CAT_ES_TO_EN` in GameCard.tsx
6. **Ratings API**: PUT requires `x-api-key` header matching `RATINGS_API_KEY` env var
7. **n8n workflow**: Uses node names in connections (not IDs)

## See Also

- [README.md](README.md) — Setup and usage
- [CHANGELOG.md](CHANGELOG.md) — Version history
