# Nintendo Deals

A personal, password-protected web app to track Nintendo eShop deals on Switch. Fetches live data from the Nintendo Europe Solr API, displays games with prices, discounts, IGDB ratings, and lets you hide or set price watch thresholds with Telegram alerts.

## Features

| Feature | Description |
|---------|-------------|
| Live deals | 2000+ Nintendo Switch games on sale, fetched on demand |
| Price filters | Pre-filtered to 0–14.99 €, digital-only, English language |
| IGDB ratings | Critic, user, and combined scores from IGDB (updated daily via GitHub Actions) |
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

Next.js 16 · TypeScript · Tailwind CSS · Vercel Blob · IGDB API · Nintendo Europe Solr API · GitHub Actions · Telegram webhook

## Deployment (Vercel)

1. Import the repo into Vercel
2. Set `ACCESS_PASSWORD` environment variable
3. Create a Blob store and connect it to the project (auto-creates `BLOB_READ_WRITE_TOKEN`)
4. Set `RATINGS_API_KEY` (shared secret for the GitHub Actions worker)
5. Deploy — region `fra1` recommended for Europe

## Automation Setup (GitHub Actions + Vercel)

The daily GitHub Actions worker handles IGDB rating lookups, Telegram price alerts, and curated digest delivery. Vercel handles Telegram callback actions through a webhook:

1. Create a Twitch app at [dev.twitch.tv](https://dev.twitch.tv/console) for IGDB API access
2. Create a Telegram bot via @BotFather
3. Add the repository secrets and variables listed below to GitHub Actions
4. Set the Vercel Telegram webhook environment variables listed below
5. Configure Telegram to deliver updates to `POST /api/telegram/webhook`:

```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://nintendo-deals.vercel.app/api/telegram/webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

## Environment Variables

| Variable | Required | Where | Description |
|----------|----------|-------|-------------|
| `ACCESS_PASSWORD` | Yes | Vercel | Password to access the app |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel | Vercel Blob token (auto-created) |
| `RATINGS_API_KEY` | Yes | Vercel + GitHub Actions | Shared secret for ratings API |
| `TWITCH_CLIENT_ID` | Yes | GitHub Actions | IGDB API auth |
| `TWITCH_CLIENT_SECRET` | Yes | GitHub Actions | IGDB API auth |
| `TELEGRAM_BOT_TOKEN` | Yes | GitHub Actions + Vercel | Telegram Bot API token |
| `TELEGRAM_CHAT_ID` | Yes | GitHub Actions | Destination chat for alerts and digest |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Vercel | Secret header used to authenticate Telegram webhooks |
| `NINTENDO_TELEGRAM_CHAT_ID` | Yes | Vercel | Allowed Telegram chat for callback actions |
| `NINTENDO_TELEGRAM_USER_ID` | No | Vercel | Optional allowed Telegram user for callback actions |
| `NINTENDO_DEALS_BASE_URL` | Yes | GitHub Actions variable | Public app URL for `Show` links and API calls |

## Architecture

```
Nintendo Solr API ──→ /api/games ──→ DealsClient (React)
                                         │
Vercel Blob ←──→ /api/preferences ←──────┤
                                         │
Vercel Blob ←──→ /api/ratings ←──────────┤
                                         │
                     /api/auth ←─────────┘

GitHub Actions (daily, 10:00 Europe/Madrid)
  ├─→ IGDB API → ratings.json → /api/ratings PUT
  ├─→ preferences.json → price check → Telegram alert (10:00 Europe/Madrid)
  ├─→ curated.json + preferences.json + Nintendo deals → Telegram curated digest (10:00, top 10 actionable)
Vercel /api/telegram/webhook
  └─→ Telegram callback query → /api/preferences/actions POST → edit digest message state
```

## License

MIT
