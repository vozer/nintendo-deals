# Nintendo Deals

A personal, password-protected web app to track Nintendo eShop deals on Switch. Fetches live data from the Nintendo Europe Solr API, displays games with prices, discounts, and lets you hide or set price watch thresholds.

## Features

| Feature | Description |
|---------|-------------|
| Live deals | 2000+ Nintendo Switch games on sale, fetched on demand |
| Price filters | Pre-filtered to 0–14.99 €, digital-only, English language |
| Hide games | Permanently hide games you're not interested in |
| Price watch | Set < 5 € or < 10 € thresholds — game hides until price drops |
| Tabs | Deals / Hidden / Watched tabs to manage preferences |
| Search | Full-text search across game titles and descriptions |
| Sort | By popularity, discount %, price (↑↓), or title (A-Z) |
| Responsive | Mobile-first 1/2/3 column grid |
| Password gate | Simple cookie-based auth via environment variable |

## Quick Start

```bash
git clone https://github.com/reglisund/nintendo-deals.git
cd nintendo-deals
cp .env.example .env.local
# Edit .env.local with your password
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

Next.js 16 · TypeScript · Tailwind CSS · localStorage · Nintendo Europe Solr API

## Deployment (Vercel)

1. Import the repo into Vercel
2. Set `ACCESS_PASSWORD` environment variable
3. Deploy — region `fra1` recommended for Europe

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ACCESS_PASSWORD` | Yes | Password to access the app |

## Architecture

```
Nintendo Solr API ──→ /api/games ──→ DealsClient (React)
                                         │
                  localStorage ←─────────┘ (preferences)
                                         │
                     /api/auth ←─────────┘
```

- **Data source**: `searching.nintendo-europe.com/es/select` (Spanish market for EUR prices)
- **Preferences**: Stored in browser localStorage (instant, consistent reads)
- **Auth**: Cookie-based, password compared against `ACCESS_PASSWORD` env var
- **Middleware**: Protects all routes except `/login` and `/api/auth`

## License

MIT
