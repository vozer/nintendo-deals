# Nintendo Deals

A personal, password-protected web app to track Nintendo eShop deals on Switch. Fetches live data from the Nintendo Europe Solr API, displays games with prices, discounts, IGDB ratings, and lets you hide or set price watch thresholds with Telegram alerts.

## Features

| Feature | Description |
|---------|-------------|
| Live deals | 2000+ Nintendo Switch games on sale, fetched on demand |
| Price filters | Original Switch only (not Switch 2), Spanish offers at 0–14.99 €, English language available |
| IGDB ratings | Missing ratings fetched daily; successful ratings refreshed only while the Nintendo release is less than two months old |
| Content filter | Hentai/dating titles auto-blocked; collections and sports in own tabs |
| Hide games | Permanently hide games you're not interested in |
| Price watch | Set < 2 €, < 5 €, or < 10 € thresholds — game hides until price drops |
| Telegram notifications | Daily newly eligible Deals, watched threshold alerts, and up to ten Nintendo Life recommendations; title images, source buttons, and in-chat actions |
| Views | Deals / Collections / Sports / Thinking / Hidden / Watched / Few Reviews / Low Quality |
| Search | Full-text search across game titles and descriptions |
| Sort | By popularity, discount %, price, title, rating, or best value |
| Responsive | Mobile-first 1/2/3 column grid |
| Password gate | Expiring signed-session cookie and bounded login attempts |

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

The daily GitHub Actions worker runs at **10:07 Europe/Madrid** (DST-aware). It handles IGDB lookups, newly eligible deal alerts, watched threshold alerts, and curated digest delivery. GitHub may delay scheduled execution; delayed events are processed rather than discarded. Vercel handles Telegram callback actions through a webhook:

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
| `RATINGS_API_KEY` | Yes | Vercel + GitHub Actions | Automation authorization for enrichment, preferences, delivery claims and deal snapshots |
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

GitHub Actions (daily, 10:07 Europe/Madrid)
  ├─→ Nintendo Life eShop Selects → curated-nintendolife.json
  ├─→ IGDB API → ratings.json → /api/ratings PUT
  ├─→ complete Nintendo offers → shared homepage eligibility → compare telegram-deals.json
  ├─→ newly eligible Deals → Telegram new-deal messages
  ├─→ preferences.json + watched-ID lookups → Telegram threshold alerts
  ├─→ Nintendo Life selections + preferences → Telegram digest (up to 10, excluding arrivals sent that run)
  └─→ successful delivery → conditional telegram-deals.json commit + redacted run artifact
Vercel /api/telegram/webhook
  └─→ validated callback → atomic preference action → edit text/caption, retain buttons
```

### Notification Behavior

- **New deal** means a game enters or re-enters the homepage Deals selection compared with the last successful daily snapshot. It does not mean a new game release. Confidence, classification, Steam moderation and shovelware rules are shared with the homepage; hidden, watched and thinking games are excluded. Browser-local excluded Steam tags are not available to the scheduler.
- **Price alert** means a watched game's discounted price is strictly below its 2/5/10 EUR threshold. These are independent of arrivals; zero threshold alerts can be correct even with many active offers.
- **Curated digest** selects up to ten active Nintendo Life games, excluding hidden/watched games and that run's new arrivals. NT Deals is a separate Deal Pick signal, not Nintendo Life curation.
- Available Nintendo title images are sent with readable, bounded HTML captions. Without an image, send text. Nintendo and available Nintendo Life links are buttons alongside Show, Hide and Alert 2/5/10 EUR.
- The first arrival run creates a quiet baseline, not a catch-up flood. Production initialization on 2026-09-30 saved 104 eligible games. Later runs compare against that set.
- Private `telegram-deals.json` stores arrival history independently of preferences. Daily claims and confirmed arrival-send markers live in internal Telegram metadata; public preference APIs expose only preferences.
- Daily replay claims are at-most-once, not exactly-once guarantees. An ambiguous send is not blindly retried. See the [operational runbook and backlog](docs/telegram-notification-backlog.md).

### Verification and Feature Status

The image/buttons/new-arrivals feature is **implemented and deployed**. [Release evidence](docs/plans/2026-09-30-telegram-deal-arrivals.md) records the live photo preview, authenticated baseline run, unchanged preferences, and local gates. The first natural production arrival and shopper-initiated caption action remain explicit validation tasks.

Local checks: `python3 -m unittest discover -s automation/tests`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run check:aiup`, and `npm run test:e2e`. Browser tests use local synthetic data, not production preference mutations.

## License

MIT
