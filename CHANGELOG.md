# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-03-07

### Fixed

- **Stale game data**: Nintendo API responses were cached by Vercel edge — switched to `cache: 'no-store'` and `dynamic = 'force-dynamic'` to always fetch fresh data
- **Hidden/watched games not persisting on reload**: Fixed Vercel Blob reads by using direct URL fetch with cache-busting instead of relying on `list()` which has ~5s eventual consistency; direct URL reads are consistent after ~2s

### Changed

- Blob read strategy: use `head()` once to discover URL, then direct `fetch()` with timestamp cache-bust and Authorization header
- `savePreferences` caches the blob URL returned by `put()` for immediate subsequent reads

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
- Browser localStorage for user preferences
- Vercel deployment with security headers (fra1 region)
- Load more pagination (48 games per page)
- Optimistic UI updates for hide/watch actions
- Logout functionality
