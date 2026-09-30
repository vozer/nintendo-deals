# Telegram Images, Source Buttons and Daily Deal Arrivals

## Changes

- UC-005 / FR-012: available title images are sent with bounded HTML captions, source buttons and existing hide/watch actions. Text is retained when no image is available; only definite image rejection permits fallback.
- Homepage and worker arrival API share the exact Deals predicate. Arrival selection additionally excludes all watched items (threshold alerts remain separate), plus hidden/thinking items; browser-local tag exclusions are not available to the scheduler.
- Private `telegram-deals.json` tracks the last successfully delivered eligible set. Missing history creates a quiet baseline, not a historical flood. A departed offer that returns is eligible again.
- Snapshot reads/writes require the automation API key; stale commits return 409. Preference values are untouched. Confirmed-send markers prevent an ambiguous Telegram claim from silently advancing the snapshot.
- Source buttons survive callbacks; photo captions are edited with `editMessageCaption`, after preference persistence.

## Evidence

- 45 TypeScript tests, 41 Python tests; lint, TypeScript checking, production build, AIUP checking, and both local Playwright viewport tests passed (375/1200 pixels).
- Read-only production Nintendo lookup: none of the 10 watched games qualifies. Dead Cells: 18.89 EUR versus 5 EUR; Disco Elysium: 11.99 EUR versus 5 EUR; the remaining eight have no current discounted price.
- Preference checkpoint: 157 hidden, 10 watched, 4 thinking. Saved locally before deployment for exact post-release comparison, without committing user data.
- Deployment and live image/snapshot evidence will be recorded after verification. Production callbacks are not simulated because that would alter the shopper's lists.

## Limitations

- No previous eligible-ID history exists, so retrospective arrivals cannot be reconstructed reliably. First run establishes today's baseline; subsequent successful daily runs notify new entrants.
- A claimed but unconfirmed new-deal send stops same-day replay for operator review; it is not blindly resent after a timeout.
- Title images are supported; video uploading is not introduced.
