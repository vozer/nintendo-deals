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
- Commit/push: authorized by the user's subsequent "do it" reply; this record captures verification before the delivery commit. Production deployment: not performed or authorized for this feature.
- Production scraper/maintenance runs: not performed, including dry-runs. Only narrow public source/snapshot reads from the planning investigation were used. No hidden/watch/thinking entry, Telegram message, webhook or credential was mutated.
- **Needs validation:** actual Safari/native-WebKit playback (no installed WebKit runtime), actual third-party trailer availability and source coverage after an authorized production enrichment run. Synthetic HLS playback was verified in local Chromium, including a forced non-native capability for the mobile player branch; this does not prove Safari or real source availability.
- Production Future Knight media/Steam caches remain unpopulated. Deployment approval alone does not authorize a backfill. A separately authorized production media run must name the target and apply mode; inspect its additive staged output before publication.
- Main push creates preview only. Production promotion requires separate explicit approval for the existing Vercel project, this release record, and read-only post-promotion smoke checks. Do not send fake Telegram actions or mutate user lists as smoke tests.
- Rollback code by promoting the prior known-good deployment with approval; keep additive enrichment fields, stop maintenance on schema/parse failure, and never restore old preference data.

## Reflection

The correction changes description fallback only, not the existing English category/UI policy. Missing Steam/media UI was primarily absent acquisition data, so render-only fixes would not have completed the feature. The lessons are captured in the existing feature research/specification; no agent-facing rule or skill file was edited.
