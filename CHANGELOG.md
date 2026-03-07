# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-03-07

### Fixed

- **Stale game data**: Nintendo API responses were cached by Vercel edge — switched to `cache: 'no-store'` and `dynamic = 'force-dynamic'` to always fetch fresh data
- **Hidden/watched games not persisting on reload**: Vercel Blob overwrites take 15–42s (avg 26s) to become readable. The PATCH handler's read→modify→write pattern caused rapid successive actions to overwrite each other with stale data

### Changed

- Preferences API changed from PATCH (read-modify-write) to PUT (write-only) — client sends full preferences state, server writes directly to Blob without reading first
- Client React state is authoritative during a session; Blob is only read on page load (always >30s after last action, so reads are consistent)
- Blob reads use `head()` to discover URL, then direct `fetch()` with timestamp cache-bust and Authorization header

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
- Vercel Blob storage for user preferences (private store)
- Vercel deployment with security headers (fra1 region)
- Load more pagination (48 games per page)
- Optimistic UI updates for hide/watch actions
- Logout functionality
