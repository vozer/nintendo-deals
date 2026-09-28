# Nintendo Deals Vision

## Purpose

Nintendo Deals helps one authenticated shopper find worthwhile original Nintendo Switch discounts in the Spanish eShop, evaluate them with trustworthy review context, and act on them from either the website or Telegram. Nintendo Switch 2 offers are outside the current product scope.

## Product Outcomes

- Show every eligible active offer from the Nintendo Europe catalog, with Nintendo as the authority for availability and EUR price.
- Separate editorial recommendation, deal discovery, and review confidence instead of presenting them as one generic curated signal.
- Preserve hide, thinking, and price-alert preferences across the website and Telegram.
- Deliver a useful daily digest and price alerts without n8n or an always-on server.
- Make every scheduled or interactive state change observable, replay-safe, and recoverable.

## System Boundary

The website and inbound Telegram webhook run on Vercel. Scheduled source refresh and outbound notification jobs run in GitHub Actions. Vercel-hosted persistence holds user preferences and enrichment data. External providers supply catalog, pricing, editorial, ratings, media, and review context; no purchase is performed.

## Source Roles

- Nintendo Europe: product identity, Spanish availability, and EUR prices.
- Nintendo Life eShop Selects: current editorial recommendation.
- Nintendo Life Current Offers: secondary deal-discovery and source-drift check only.
- IGDB: critic/user rating enrichment, refreshed only while a game is less than two months old and otherwise retained after its first successful match.
- Steam: optional cross-platform review confidence and a review link when the title match is reliable.
- SteamSpy: optional cached tag enrichment; an outage must not change deal eligibility or erase known tags.
- NT Deals: secondary deal-pick signal from the Spanish Switch feed; never a price authority or confidence bypass.
- Telegram: notification and action transport; it is not the preference source of truth.

## Out Of Scope

- Automated purchases.
- Public multi-user accounts in the current release.
- Reintroducing n8n, Raspberry Pi scheduling, or a Telegram polling process.
