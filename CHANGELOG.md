# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-03-06

### Fixed

- **Stale game data**: Nintendo API responses were cached by Vercel edge — switched to `cache: 'no-store'` and `dynamic = 'force-dynamic'` to always fetch fresh data
- **Hidden/watched games not persisting**: Vercel Blob had eventual consistency issues causing preferences to reset on reload — replaced with browser localStorage for instant, reliable reads

### Changed

- User preferences (hidden games, watch thresholds) now stored in browser localStorage instead of Vercel Blob
- Removed `/api/preferences` route and `lib/blob-storage.ts`
- Removed `@vercel/blob` dependency
- `BLOB_READ_WRITE_TOKEN` environment variable no longer needed

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
