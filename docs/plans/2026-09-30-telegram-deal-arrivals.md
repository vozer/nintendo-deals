# Telegram Images, Source Buttons and Daily Deal Arrivals

**Closeout:** Implementation complete and deployed. Documentation synchronized with README, CHANGELOG, FR-012 and UC-005/006. Open validation and improvement items are explicitly tracked as ND-001 through ND-008 in the [notification backlog](../telegram-notification-backlog.md); they are not represented as implemented or production-verified.

**Affected specification IDs:** FR-006, FR-007, FR-008, FR-012; NFR-002, NFR-004, NFR-005, NFR-011; UC-005, UC-006; DAILY_DEALS_SNAPSHOT. No PR was created for this direct-to-main delivery.

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
- Code commit `c2af080` pushed to `main` and deployed explicitly to the existing production project. Vercel deployment `74N7T34YRJ5U41NcgkAdfDMnSrFd` is aliased to `https://nintendo-deals.vercel.app`.
- One real Future Knight photo preview was accepted by Telegram with Nintendo/Nintendo Life buttons. No image rejection or text fallback occurred. Production callbacks are not simulated because that would alter the shopper's lists; caption callbacks were covered at the local HTTP boundary.
- Real non-dry-run GitHub execution [36731310379](https://github.com/vozer/nintendo-deals/actions/runs/36731310379) succeeded: 3,053 catalog offers, 104 homepage-eligible games, quiet first baseline persisted, 77 missing ratings added, zero watched threshold alerts, and zero duplicate digest sends (10 already claimed earlier that day).
- Anonymous production arrival POST and delivery-status GET both returned 401. The successful authenticated worker crossed the real comparison and snapshot-commit API boundaries.
- Exact before/after preference JSON comparison passed: all 157 hidden, 10 watched titles/thresholds, and 4 thinking items unchanged. The new snapshot was read independently from private Blob and contains 104 IDs dated 2026-09-30.

## Limitations

- No previous eligible-ID history exists, so retrospective arrivals cannot be reconstructed reliably. First run establishes today's baseline; subsequent successful daily runs notify new entrants.
- A claimed but unconfirmed new-deal send stops same-day replay for operator review; it is not blindly resent after a timeout.
- Title images are supported; video uploading is not introduced.

## Reflection

The repeated confusion was terminology: existing "price alerts" meant watched thresholds, not newly eligible offers. Distinct `price_alerts` and `new_deals` run metrics now make that difference explicit. This was a product behavior gap, not a workspace-rule gap; no agent instructions were changed. The unrelated pre-existing AGENTS.md change and local browser output remain untouched.

## Follow-Up: Steam Review Button Preference

- All new game messages (arrivals, watched alerts, curated digests) prefer a cached Steam destination instead of Nintendo Life. Without a usable Steam match, Nintendo Life remains the fallback; Nintendo's store button and all preference actions are unchanged. Existing Telegram messages are not retroactively edited.
- The worker reads `/api/steam` once and attaches matched destinations by Nintendo ID, including direct watched-game lookups. It accepts HTTPS Steam app URLs or constructs a canonical app URL from an existing positive Steam ID. It neither searches Steam by title nor changes game eligibility, curation or preferences.
- Verification: 44 Python tests, 45 TypeScript tests, TypeScript checking and AIUP/diff hygiene passed. Outgoing-message and mocked-HTTP worker tests cover curated/non-curated cases, app-ID fallback and invalid-URL fallback. Read-only production data contained 1,335 usable cached destinations; button construction was checked for curated ID 2888529 and non-curated ID 1204623.
- This is a Python worker/documentation change only. No Vercel route, frontend or dependencies changed; the prior build/browser release evidence remains applicable. No new production scraper run, Telegram message, webhook update or preference write was performed. Pushing activates the change for future GitHub Actions executions; no separate Vercel deployment is necessary.
