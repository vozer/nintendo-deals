# Nintendo Deals — AI Agent Context

**Public repository — NEVER commit secrets, tokens, or passwords.**

## Overview

Personal Nintendo eShop deal tracker. Displays Switch games on sale in the Spanish market (EUR prices), with hide/watch/search/sort features. Single-user, password-protected.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Storage | Vercel Blob (private store) |
| Data source | Nintendo Europe Solr API |
| Hosting | Vercel (fra1 region) |
| Auth | Cookie-based password gate |

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
| `app/api/games/` | Nintendo API proxy with search/sort/pagination |
| `app/api/preferences/` | Blob-backed preferences CRUD |
| `app/login/` | Password login page |
| `components/` | React components (GameCard, DealsClient, SearchBar, SortSelect) |
| `lib/` | Shared utilities (types, API client, blob storage) |

## Key Files

| File | Purpose |
|------|---------|
| `middleware.ts` | Auth middleware — redirects unauthenticated users to /login |
| `lib/nintendo-api.ts` | Solr query builder with base filters and sort mapping |
| `lib/blob-storage.ts` | Vercel Blob read/write for preferences.json |
| `lib/types.ts` | TypeScript interfaces (NintendoGame, Preferences, etc.) |
| `components/GameCard.tsx` | Game card with hide/watch buttons and category translation |
| `components/DealsClient.tsx` | Main page: tabs, grid, search, sort, optimistic updates |
| `vercel.json` | Vercel config: region, headers, build settings |

## Nintendo Solr API

- **Endpoint**: `https://searching.nintendo-europe.com/es/select`
- **Locale**: `/es/` for Spanish market (EUR prices, Spanish descriptions)
- **Base filters**: Switch games, on sale, 0–14.99 €, English language available, digital-only
- **Search**: Uses Solr `q` parameter for full-text search
- **Sort options**: popularity, discount %, price, title

## Deployment (Vercel)

- **Platform**: Vercel
- **Region**: fra1 (Frankfurt)
- **Auto-deploy**: OFF — use `npx vercel --prod --yes` to deploy
- **URL**: https://nintendo-deals.vercel.app
- **Env vars**: `ACCESS_PASSWORD`, `nintendo_READ_WRITE_TOKEN` (Blob store token)

## Conventions

- UI language: English (categories translated from Spanish via `CAT_ES_TO_EN` map)
- Prices: EUR (Spanish eShop)
- Descriptions: Spanish (from ES Solr endpoint — trade-off for correct prices)
- Preferences stored in Vercel Blob (private store, single `preferences.json` file)
- Blob has ~2s eventual consistency on overwrites; reads use direct URL fetch with cache-busting
- Optimistic updates: Client updates state immediately, persists to Blob in background

## Critical Rules

1. **No secrets in code** — all sensitive values via environment variables
2. **No force push** — public repo
3. **Verify builds** — `npx tsc --noEmit` before deploying
4. **Test API changes** — `curl` against deployed endpoints
5. **Categories**: Always add new ES→EN translations to `CAT_ES_TO_EN` in GameCard.tsx

## See Also

- [README.md](README.md) — Setup and usage
- [CHANGELOG.md](CHANGELOG.md) — Version history
