# Game Detail Upgrade: Local Delivery Evidence

## Approval and Scope

Implemented the approved HTML plan against baseline `38f35ef`. User correction: prefer official English descriptions, but retain Spanish descriptions when English is unavailable. No translation service was added. Stable affected IDs: FR-004, FR-005, FR-009, NFR-002, NFR-004, NFR-008, NFR-009, NFR-010; UC-002, UC-003, UC-004; GAME_MEDIA/MEDIA_ASSET.

## Implemented

- Shared card/detail Hide/Unhide, Thinking, fixed 2/5/10 EUR alerts and remove-watch controls. Saves wait for the existing atomic preference endpoint and display persistence feedback/errors/retry. Lost Thinking responses are reconciled against a fresh read before retrying a non-idempotent toggle. No preference schema/storage or Telegram change.
- English Nintendo descriptions joined by exact ID in the shared catalog path, covering direct game links, search and listing/full-catalog requests. Up to four 100-ID batches concurrently; one-hour server cache and ten-second request timeout. Original Spanish prices, links and category-policy fields remain unchanged. Spanish description fallback is retained. Shared English category/date presentation.
- Canonical Steam links on cards/details use either review identity or validated media identity, without inventing review scores. Nintendo/Nintendo Life/IGDB links remain additive.
- Selectable multiple videos/screenshots, provenance and Steam-PC labels, bounds-safe delayed media handling, image fallback, non-autoplay YouTube/native/HLS playback, and source-page links. Lazy-loaded pinned `hls.js` 1.7.3 supports browsers without native HLS. Cold loading does not assign an unsupported native HLS URL; controls wait for player attachment.
- Native dialog focus lifetime separated from gallery navigation; keyboard access to card openers; focus fallback when hiding removes the opener.
- Repaired maintenance CLI imports and Nintendo URL field acquisition. Target ID/limit/incomplete-refresh inputs reuse the existing manual workflow. Nintendo/IGDB/validated Steam assets merge rather than replace; video-field merging preserves cached streams on partial refresh. Steam search outages and skipped Nintendo parser records mark acquisition incomplete. IGDB canonical source links come from its API, not generated slugs.
- Conditional additive enrichment updates: GET ETag, required PUT If-Match (428 missing, 409 stale), three bounded Blob conflict attempts, preservation of unrelated entries/assets. No whole-cache deletion or preference migration. Media publishes only staged IDs.

## Verification

All commands ran from this repository using Node 24.21.0 (the host default was Node 26 and was not used for final gates).

| Gate | Result |
|---|---|
| `npm test` | 62 tests passed, 15 files |
| `python3 -m unittest discover -s automation/tests -p 'test*.py'` | 54 tests passed; mocked providers/Telegram only |
| `npx tsc --noEmit` equivalent via local tsc binary under Node 24 | Passed |
| `npm run lint` | Passed, no lint warnings |
| `npm run build` | Passed, all application/API routes compiled |
| `npm run check:aiup` | Passed |
| `npm run test:e2e` | Four local Chromium tests passed at 375px/1200px |
| Both maintenance `--help` invocations | Passed from clean CLI entry points |
| `git diff --check` | Passed |

Browser checks include actual playback of generated synthetic HLS video segments, a delayed player chunk/non-native-HLS branch, provider video selection, Steam links without scores, all thresholds, hide/unhide, Thinking reconciliation after a lost saved reply, save failure/retry, unrelated-list retention, focus recovery, deep links/login, no horizontal overflow and no serious/critical axe findings. API tests cover auth denial, malformed/unsafe snapshots, missing/stale revisions on both enrichment endpoints and failed reads. Storage tests exercise conditional conflict preservation/stale rejection. Python tests cover six Nintendo screenshots, URL acquisition, Steam demo/namesake/publisher rejection, bounded tag acquisition, IGDB pagination/partial failure and cached media preservation.

Screenshots inspected visually and retained:

- [375px detail dialog](../research/evidence/game-detail-upgrade-375.png)
- [1200px detail dialog](../research/evidence/game-detail-upgrade-1200.png)

Initial failed checks were diagnosed and fixed: empty gallery grouping semantics, MPEG-TS fixture filenames being mistaken for TypeScript, a capability-dependent HLS assertion, and a synchronous effect-state lint warning. Reviews identified optional revision bypass, cached stream replacement, falsely complete provider failures, missing IGDB links and unbounded tags-only mode; each was repaired with focused checks. Follow-up standards/spec reviews reported no residual blockers. These reviews were read-only and did not perform production checks.

## Delivery Status and Remaining Gates

- Local implementation and specification changes: complete. Pre-existing `AGENTS.md`, `.playwright-cli/`, and `output/` changes remain untouched and outside this feature.
- Implementation committed as `2887f228268937924ed86d96a397ad4365942821` and pushed to `origin/main`; remote hash verified. Production deployment subsequently authorized by the user's "deplot" reply and completed on 2026-09-30.
- Production scraper/maintenance runs: not performed, including dry-runs. Only narrow public source/snapshot reads from the planning investigation were used. No hidden/watch/thinking entry, Telegram message, webhook or credential was mutated.
- **Needs validation:** actual Safari/native-WebKit playback (no installed WebKit runtime), actual third-party trailer availability and source coverage after an authorized production enrichment run. Synthetic HLS playback was verified in local Chromium, including a forced non-native capability for the mobile player branch; this does not prove Safari or real source availability.
- Production Future Knight media/Steam caches remain unpopulated. Deployment approval alone does not authorize a backfill. A separately authorized production media run must name the target and apply mode; inspect its additive staged output before publication.
- Main push creates preview only. Production promotion requires separate explicit approval for the existing Vercel project, this release record, and read-only post-promotion smoke checks. Do not send fake Telegram actions or mutate user lists as smoke tests.
- Rollback code by promoting the prior known-good deployment with approval; keep additive enrichment fields, stop maintenance on schema/parse failure, and never restore old preference data.

## Reflection

The correction changes description fallback only, not the existing English category/UI policy. Missing Steam/media UI was primarily absent acquisition data, so render-only fixes would not have completed the feature. The lessons are captured in the existing feature research/specification; no agent-facing rule or skill file was edited.

## Production Deployment Evidence

- Deployed a clean `git archive` of implementation commit `2887f22`, linked to existing project `prj_Q7P2HU6CEneLl6YDAV77WvLHKSQi`. Unrelated local files were not uploaded. No new Vercel project was created.
- Vercel deployment `dpl_DPWJs1p39DLe24pRGLRvdjoMK3cj`: Production, Ready. URL: https://nintendo-deals-9o8cyrqt0-vozers-projects.vercel.app. Production alias https://nintendo-deals.vercel.app verified by `vercel inspect`; functions use fra1. Remote production build and TypeScript checks passed.
- Read-only GET smoke: unauthenticated and invalid-session game deep links redirect 307 to `/login?next=%2F%3Fgame%3D3151132`; login page returns 200; authenticated homepage returns 200 and retains the game ID.
- Authenticated `GET /api/game?fs_id=3151132` returns 200, Future Knight, `excerpt_language: en`, with the official English description. `GET /api/media` and `/api/steam` return 200, parseable maps and ETag headers.
- CLI `list --json` was unsupported; normal `list` worked. Initial game smoke used an incorrect `id` parameter and correctly received 400; the documented `fs_id` request passed. Neither error was a production application failure.
- No production browser mutation tests, enrichment runs, preference writes, Telegram sends or webhook changes performed. Remaining Safari/source-coverage gates above are unchanged; deployment does not populate absent media caches.

## Extended Production Test: 2026-09-30

User requested production verification after deployment. Tested the real production site in headed Chromium using an isolated signed session from the existing local production configuration; no password, token or session was saved in this report. All application requests were reads. No save/hide/watch/thinking control was clicked.

### Passed

- Unauthenticated deep link preserves `game=3151132` through the login redirect. Authenticated deep link opens Future Knight's actual dialog. English description, English categories, correct 11.99 EUR sale price and additive Nintendo/Nintendo Life links appear. Its existing below-5-EUR alert is selected, with Remove alert present.
- Real 375x812 and 1200x900 layouts inspected visually: cover loads, action buttons wrap, dialog scrolls, no horizontal document or dialog overflow. Screenshots retained locally under `output/playwright/production-detail-{375,1200}.png`.
- Tab remains inside the modal. Card keyboard activation (Axiom Verge, Enter) opens details, and Escape restores focus to that card opener. Axe audit of the live Future Knight dialog reports zero violations and 20 passing rules.
- Blaster Master Zero (`1204623`): six screenshots and thumbnails load; Next screenshot changes the main image to screenshot 2 without stealing focus. Trailer selection replaces the image with the real YouTube privacy-enhanced player. Explicit Play starts playback, with current time advancing beyond three seconds, readyState 4 and no media error. Canonical Steam Reviews link is present alongside Nintendo, IGDB and source links. The page has 34 rendered Steam tile links.
- Production preferences/media/Steam/curated reads and two catalog pages return 200; media/Steam ETags exist. Catalog pages at offsets 0/3 and search `mario` pages at offsets 0/3 are disjoint; search returns three games each with total 272.
- All 48 initially rendered Deals card IDs were checked against current preferences: zero hidden, watched or Thinking leaks. Preferences SHA-256 before/after the test matches; counts remain 157 hidden, 11 watched and four Thinking. No user preference entry changed.
- Application console contains no errors in the tested gallery flow. Actual external video playback was tested, not only iframe presence.

### Findings and Unverified Boundaries

1. **Missing enrichment, not complete end-to-end:** Future Knight has neither a media record nor a Steam rating/match record in production. Consequently it has a cover but no gallery/trailer or Steam button. The UI cannot create absent provider data. An explicitly authorized, reviewed additive production backfill remains necessary.
2. **Legacy media matching issue:** Blaster Master Zero's cached IGDB URL points to `blaster-master-zero-ex-character---shantae`, not the base game. Its video is the official Version 1.3 update trailer. The screenshot/player UI works, but this cached provider association is not a validated base-game association. This test did not change that record or claim its rating data is wrong.
3. **Direct-link keyboard focus regression:** fixed in the deployed release. Modal cleanup treats BODY as having no usable opener and moves focus to the game-search field; the synthetic Playwright suite checks Escape and close-button focus restoration after both login-preserved and already-authenticated `?game=` deep links. Production keyboard focus itself was not tested with an authenticated browser after deployment.
4. **Presentation improvement:** fixed in the deployed release. Empty Media selection is omitted when no media exists; expired/non-sale NT Deals context is explicitly labeled historical. No provider data was changed by deployment.
5. **Not tested against production:** preference persistence/retry/denied-write paths, Telegram callbacks or notifications, maintenance publication, actual HLS/direct-video sources and Safari/native-WebKit. Their deterministic local evidence remains in the earlier verification section; no real production mutation was used as a test.

Test tooling corrections: the CLI sandbox cannot require Node modules, so signed-session setup was performed externally without exposing credentials; the installed CLI uses `requests`, not `network`. The initial card audit incorrectly targeted native buttons instead of the existing role-button divs and returned zero cards; corrected audit asserted 48 cards before evaluating exclusions. These were harness errors, not production passes or application failures.

## Follow-Up Deployment: 2026-10-05

- The focus and presentation repairs shipped with commit `f58ab2e` in Vercel deployment `dpl_GnW7WqfmJo8oQwpmDt8GJxmV3QYL`, now Ready at `https://nintendo-deals.vercel.app`.
- Read-only post-deployment smoke: homepage redirects 307 to login, `/login` returns 200, and unauthenticated GETs to `/api/offer-end-dates` and `/api/telegram/audit` return 401.
- The release did not run the media crawler or publish `media.json`; Future Knight's missing gallery/Steam match and the legacy cached association remain data-enrichment work. No preferences, Telegram messages, callbacks, ratings or media records were mutated.
