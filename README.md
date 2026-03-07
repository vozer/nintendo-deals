# Nintendo Deals

A personal, password-protected web app to track Nintendo eShop deals on Switch. Fetches live data from the Nintendo Europe Solr API, displays games with prices, discounts, IGDB ratings, and lets you hide or set price watch thresholds with Telegram alerts.

## Features

| Feature | Description |
|---------|-------------|
| Live deals | 2000+ Nintendo Switch games on sale, fetched on demand |
| Price filters | Pre-filtered to 0–14.99 €, digital-only, English language |
| IGDB ratings | Critic, user, and combined scores from IGDB (updated daily via n8n) |
| Content filter | Hentai/dating titles auto-blocked; collections and sports in own tabs |
| Hide games | Permanently hide games you're not interested in |
| Price watch | Set < 2 €, < 5 €, or < 10 € thresholds — game hides until price drops |
| Telegram alerts | Daily check sends notification when watched game drops below threshold |
| 5 Tabs | Deals / Collections / Sports / Hidden / Watched |
| Search | Full-text search across game titles and descriptions |
| Sort | By popularity, discount %, price, title, rating, or best value |
| Responsive | Mobile-first 1/2/3 column grid |
| Password gate | Simple cookie-based auth via environment variable |

## Quick Start

```bash
git clone https://github.com/vozer/nintendo-deals.git
cd nintendo-deals
cp .env.example .env.local
# Edit .env.local with your password and Blob token
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

Next.js 16 · TypeScript · Tailwind CSS · Vercel Blob · IGDB API · Nintendo Europe Solr API · n8n · Telegram

## Deployment (Vercel)

1. Import the repo into Vercel
2. Set `ACCESS_PASSWORD` environment variable
3. Create a Blob store and connect it to the project (auto-creates `BLOB_READ_WRITE_TOKEN`)
4. Set `RATINGS_API_KEY` (shared secret for n8n workflow)
5. Deploy — region `fra1` recommended for Europe

## n8n Setup (Raspberry Pi)

The n8n workflow handles IGDB rating lookups and Telegram price alerts daily:

1. Create a Twitch app at [dev.twitch.tv](https://dev.twitch.tv/console) for IGDB API access
2. Create a Telegram bot via @BotFather
3. Set n8n environment variables: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `RATINGS_API_KEY`, `NINTENDO_TELEGRAM_CHAT_ID`
4. Add Telegram credential `Nintendo Deals Bot` in n8n
5. Activate workflow `VHlYChVKtFofIVdp`

## Environment Variables

| Variable | Required | Where | Description |
|----------|----------|-------|-------------|
| `ACCESS_PASSWORD` | Yes | Vercel | Password to access the app |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel | Vercel Blob token (auto-created) |
| `RATINGS_API_KEY` | Yes | Vercel + n8n | Shared secret for ratings API |
| `TWITCH_CLIENT_ID` | Yes | n8n | IGDB API auth |
| `TWITCH_CLIENT_SECRET` | Yes | n8n | IGDB API auth |
| `NINTENDO_TELEGRAM_CHAT_ID` | Yes | n8n | Your Telegram chat ID |

## Architecture

```
Nintendo Solr API ──→ /api/games ──→ DealsClient (React)
                                         │
Vercel Blob ←──→ /api/preferences ←──────┤
                                         │
Vercel Blob ←──→ /api/ratings ←──────────┤
                                         │
                     /api/auth ←─────────┘

n8n (Raspi, daily cron)
  ├─→ IGDB API → ratings.json → /api/ratings PUT
  └─→ preferences.json → price check → Telegram alert
```

## License

MIT
