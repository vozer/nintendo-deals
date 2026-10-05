# Nintendo Deals

## Game Details Upgrade (Local Implementation, 2026-09-30)

- Cards and details share Hide/Unhide, Thinking, and Alert <2/<5/<10 EUR controls. Clicking the active threshold removes the alert. Save feedback waits for persistence; failures offer retry. Hiding keeps the detail dialog open.
- Nintendo English descriptions are joined by exact game ID, cached for one hour, and requested in bounded batches. Spanish descriptions remain the fallback. Prices, Spanish store links, availability and classification stay sourced from the ES catalog.
- Steam links also use validated media matches when review scores are unavailable. No review score is invented, and existing Nintendo Life/Nintendo links remain available.
- Details expose every collected screenshot and selectable video, source attribution, PC labels for Steam media, image fallback, and source links for unsupported video. HLS uses native playback or lazy-loaded `hls.js`; videos do not autoplay.
- Media/Steam writes preserve unrelated entries with Blob conditional writes. GET exposes an ETag; publication requires `If-Match` (428 if missing), and stale revisions return 409. Media accepts additive per-ID maps using the same JSON request shape, without sending the entire cache. Partial video refreshes preserve cached playback URLs.
- Production deployment and enrichment runs require separate explicit authorization; this local implementation has not populated Future Knight's production media.

### Focused Media Maintenance

The existing manual maintenance workflow accepts `game_id`, `limit` (1-100), and `refresh_incomplete`. Scripts default to dry-run; dry-run retrieves and stages assets without publishing. Even production-targeted dry-runs require explicit scraper-run approval. Media CLI `--output <new-file>` records before/after entries and revision without overwriting an existing file. Cached IGDB IDs are revalidated against title, original Switch platform, game type and edition before asset acquisition; validated `igdb_match` is independent of frozen ratings, and replaced associations retain `legacy_igdb_url`. No new enrichment schedule is added.

For an explicitly authorized full-catalog refresh, the same media CLI accepts `--all`, which revisits existing complete entries and bypasses the small-run limit. It is mutually exclusive with `--game-id`; it retains the existing original-Switch/catalog rules and excludes blocked titles and returned prices above the cap. This is an operator-run mode, not a new scheduled job. Stage with a fresh `--output` path, retain a recovery snapshot, review exact changed records and publish only with the required authorization and current revision.

Every run now freezes its selection and starting snapshots in a local SQLite checkpoint under `output/media-crawls/<run-id>/`; each game's result and provider status are committed durably before progress is printed. A provider exception saves the current partial result and manifest, then stops before the next game. The run directory is gitignored. If interrupted, resume with `--resume <run-dir>`; `--retry-incomplete` explicitly retries saved partials, and `--export-only` reconstructs a manifest without network requests. Each export is new and non-overwriting. Publish only after inspecting the staged manifest, with `--resume <run-dir> --apply --apply-manifest <reviewed-file>`; apply requires an exact match to the checkpoint, refuses pending/incomplete runs, checks the frozen revision, and preflights the Vercel request and projected response against the function body limit. The previously interrupted 1,500-game crawl left no media payloads to recover, so those games must be fetched again.

```bash
# Only against an explicitly authorized target; replace localhost with production only after approval.
python3 scripts/media-backfill.py --base-url http://127.0.0.1:3100 --game-id 3151132 --limit 1 --refresh-incomplete
```

`--apply` is only accepted with a completed `--resume` checkpoint and its previously staged manifest, after inspecting the additive result and explicitly authorizing that target. Deploy the revision-aware API first. `RATINGS_API_KEY` is required for writes; IGDB credentials are optional for Nintendo/Steam-only media, but their absence is recorded as incomplete. Validated Steam matching checks title, edition, product type, and publisher/developer; ambiguous or mismatched candidates are omitted. IGDB acquisition is bounded at 500 screenshots/500 videos per game and reports incomplete collection at the limit or on source failures. Media browsing and enrichment never mutate preferences or send Telegram messages.

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
| Telegram notifications | Daily new/changed/re-entered offer notices, watched price alerts, and up to ten curated transition picks; title images, source buttons, and in-chat actions |
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
  ├─→ complete Nintendo offers → compare active price/episode snapshot
  ├─→ new, changed-price, or re-entered homepage deals → one Telegram message per transition
  ├─→ preferences.json + watched-ID lookups → threshold alerts for explicitly discounted games
  ├─→ Nintendo /v1/price hook → exact-price offer end dates for tiles and messages
  └─→ permanent delivery/audit records → conditional offer-state commit + redacted run artifact
Vercel /api/telegram/webhook
  └─→ validated callback → atomic preference action → edit text/caption, retain buttons
Vercel /api/telegram/audit
  └─→ immutable private inbound/outbound event history; bounded API-key-protected search
```

### Notification Behavior

- **New deal** means an offer enters the complete original-Switch snapshot; **offer changed** means its discounted price changes; **offer returned** means a complete crawl observed it absent before it reappeared. A stable price in one continuous episode is not sent again on later days. Homepage eligibility still applies, including confidence, classification, Steam moderation, and exclusions for hidden, watched, and thinking games. Browser-local excluded Steam tags are not available to the scheduler.
- **Price alert** means a watched game's explicitly discounted price is strictly below its 2/5/10 EUR threshold. The stable game/offer state can be alerted once; a changed price or return is a distinct offer state.
- **Curated picks** select up to ten active Nintendo Life games for context on eligible offer transitions; unchanged games do not produce a repeated daily digest message. NT Deals is a separate Deal Pick signal, not Nintendo Life curation.
- **Offer end date** is read from Nintendo's official price hook, matched by Nintendo Shop ID and exact discounted cents. Tiles and messages omit the date if the hook is absent, expired, stale, or does not match the current sale.
- Available Nintendo title images are sent with readable, bounded HTML captions. Without an image, send text. Link buttons are additive: Show, Nintendo, Steam and Nintendo Life are retained whenever their destinations exist. Steam is also available for non-curated games. Hide and Alert 2/5/10 EUR remain on the original game message.
- Setting an Alert from Telegram sends a persistent chat confirmation, for example `Future Knight Alert for <5€ set`, retaining Show (the app game deep link) and all available source URL buttons. The callback is acknowledged silently to clear the spinner, not as a temporary success toast. Duplicate callback delivery does not duplicate confirmed replies; the original game caption/text still updates. Confirmation replies omit mutating buttons to avoid recursive actions.
- The first transition-snapshot run creates a quiet baseline, not a catch-up flood. It imports current active prices without sending historical messages.
- Private `telegram-deals.json` stores offer episodes independently of preferences. Permanent event delivery claims and Telegram audit records are separate private Blob objects; public preference APIs expose only preferences.
- Delivery is at-most-once, not exactly-once. An ambiguous send is not blindly retried; the outbound request and response/unknown state remain searchable by date and filters in `/api/telegram/audit`.

### Telegram Audit API

`GET /api/telegram/audit` requires `x-api-key: $RATINGS_API_KEY`. Dates are UTC and default to the current UTC day. Optional query parameters are `date=YYYY-MM-DD`, `direction=inbound|outbound|internal`, `kind=<event-kind>`, `correlation_id=<id>`, `q=<text>`, `limit=1..100`, and opaque `cursor=<next-page-cursor>`. Filtered reads scan at most 500 stored events per request and return a continuation cursor when more history remains. Audit records have no application-configured retention TTL; credentials and bot-token URLs are redacted before storage.

### Verification and Feature Status

The image/buttons/new-arrivals baseline is **implemented and deployed**. The transition suppression, permanent Telegram history, and official expiry display are implemented locally and have not been deployed. [Release evidence](docs/plans/2026-09-30-telegram-deal-arrivals.md) records the deployed baseline. The first natural production arrival and shopper-initiated caption action remain explicit validation tasks.

Local checks: `python3 -m unittest discover -s automation/tests`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run check:aiup`, and `npm run test:e2e`. Browser tests use local synthetic data, not production preference mutations.

## License

MIT
