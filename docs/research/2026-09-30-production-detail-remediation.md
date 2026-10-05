# Production Detail Findings: Causes and Proposed Repair

Status: research and approval proposal only. No implementation, production scrape, snapshot publication, preference change, Telegram send or credential rotation authorized by this research request.

2026-10-01 approval amendment: matching/focus/presentation implementation approved; proposed new daily enrichment orchestration rejected. Use the existing crawler, no new schedule. Operator requested production refresh; full eligible catalog versus the two investigated IDs is being confirmed before writes. No destructive asset retirement, rating-score refresh, preference mutation or Telegram send is included.

## Evidence

On 2026-09-30, production browser checks reproduced the issues documented in [release evidence](../plans/2026-09-30-game-detail-upgrade-release.md#extended-production-test-2026-09-30). Additional narrow public snapshot reads returned 2,495 media records, zero records with `collection_complete: true`, and zero `steam_match` records. These are legacy-or-incomplete records, NOT proof that all their assets are broken. Future Knight (`3151132`) was absent from media, Steam and ratings snapshots.

GitHub's retained maintenance run listing was empty. The latest successful daily run [36731310379](https://github.com/vozer/nintendo-deals/actions/runs/36731310379) ran curation and the daily worker, not media/Steam maintenance. Retention limits prevent claiming that maintenance has never run historically.

## 1. Missing Future Knight Media and Steam Link

**Cause:** the UI consumes stored enrichment rather than collecting it. [Maintenance workflow](../../.github/workflows/nintendo-deals-maintenance.yml#L3) is manual-only. [Daily worker](../../automation/run_daily.py#L541) enriches ratings and sends notifications; it does not populate media or Steam snapshots. A Vercel deployment does not run Python maintenance. Thus deployment improved rendering/acquisition code but did not complete the data population step.

The new media acquisition already obtains a validated Steam identity independently of review counts: [script](../../scripts/media-backfill.py#L234), [Steam link presentation](../../lib/game-presentation.ts). A separate Steam ratings backfill is not required merely to show a valid Steam link.

**Proposed immediate repair:** after code validation and explicit scraper authorization, stage a focused production media acquisition for `3151132`, with no API writes. Show provider matches, changed records and preserved assets. Publish only that approved additive record through the existing ETag-protected media API. Re-test its screenshots, canonical Steam link and real trailer playback. Source counts from earlier research are not guaranteed current counts.

**Prevent recurrence:** reuse the existing GitHub Actions setup for a separate bounded media-maintenance job after the daily worker, outside Telegram's delivery critical path. Prioritize missing media, then due incomplete entries, max 25 games/run; preserve cached assets on outage and report deferred/failed/missing matches in a redacted artifact. Do not automatically rewrite all 2,495 legacy entries. Avoid repeated failed entries starving new games by recording attempt/retry timing. Activation of recurring production acquisition/publishing needs separate approval naming production target, apply mode and daily bound. No web-request scraping, new service or n8n.

## 2. Legacy IGDB Add-On Association

Production Blaster Master Zero (`1204623`) exposed a cached IGDB URL ending in `blaster-master-zero-ex-character---shantae`, with a working official Version 1.3 update video. A working player is not evidence of a correctly matched base game.

The focused agent confirmed the public rating record still contains IGDB ID `171205`, matched title `Blaster Master Zero: EX Character - Shantae`, historical confidence 100, null scores and zero counts, dated 2026-03-07. The historical media script constructed its URL from that kind of matched title and trusted the rating ID for media. The current title matcher rejects this title pair, but the game is from 2017 and the routine refresh policy intentionally leaves its existing rating record frozen. The precise original matching execution is unavailable; do not attribute the March write to the September matcher or treat this as evidence of a wrong displayed score.

The independent focused investigation records history, certainty limits and proposed matching corrections in [legacy matching research](2026-09-30-legacy-igdb-media-matching.md). The current media path reuses an IGDB ID from ratings without first validating its identity ([script](../../scripts/media-backfill.py#L229)); additive merges preserve old assets ([storage](../../lib/media-storage.ts#L15)). Refresh alone therefore does not guarantee correction of inherited assets.

**Proposed repair:** validate provider title, original Switch platform, base-game/add-on type, parent relationship and edition before acquiring or displaying newly validated IGDB media. A cached rating ID is a candidate, not proof. If rejected, resolve a unique eligible base-game match or skip IGDB with an explicit reason; keep Nintendo and validated Steam media usable. Record provider identity/validation provenance independently of rating scores. Preserve the user's two-month score freeze policy: this is media identity validation, not daily score recalculation.

Keep raw legacy records/assets recoverable. Do not delete/rebuild the media map or silently relabel old assets as validated. Stage a focused `1204623` repair and distinguish verified assets from retained legacy/unverified assets in presentation. Its official base-game update trailer may remain as explicitly labelled supplemental footage; the add-on association does not prove the video is unrelated. Any actual retirement/removal or replacement of the old link requires a recoverable exact manifest and later approval under workspace destructive-action rules. Do not label an update trailer as a launch trailer. No verified replacement numeric IGDB ID was obtained in this research.

## 3. Direct-Link Focus Restoration

**Cause:** [modal cleanup](../../components/GameDetailModal.tsx#L49) captures `document.activeElement`, then considers `isConnected` sufficient for restoration. With direct links the captured element is BODY. BODY remains connected, so the fallback never runs, and `.focus()` does not move focus to a usable browse control. Card-opened dialogs capture a real opener and work.

**Repair:** restore the connected usable opener when present, otherwise focus the existing search input (a logical next browse action). Verify actual focus after restoration and fallback if the target cannot accept it. No custom focus-trap library. Add direct-link Escape/close-button tests, alongside opener-retention and hidden-opener tests. This follows [W3C's modal focus guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/#keyboard-interaction).

## 4. Small Presentation Corrections

Hide Media selection when there are no media choices ([modal](../../components/GameDetailModal.tsx#L159)). Legacy NT Deals context can display a historical discount alongside a currently non-sale Nintendo game; label expired/undated source context as historical and keep Nintendo's price authoritative. Do not fabricate refresh dates or delete source curation.

## Approval and Execution Order

1. Approve implementation: synchronize FR-005/FR-009, UC-002/UC-004 and GAME_MEDIA/MEDIA_ASSET, then implement matching/provenance, focus, small presentation changes and bounded maintenance orchestration. Deterministic synthetic API/provider/browser tests, denial paths, TypeScript/lint/build/Python/AIUP gates. Preserve unrelated local changes.
2. Approve deployment separately after reviewed local evidence. Promotion alone does not authorize scraping or Telegram notifications.
3. Authorize production-targeted **staging only** for IDs `3151132` and `1204623`, target `https://nintendo-deals.vercel.app`, media dry-run mode, at most two records. This permits source reads but no publication, preference writes or sends. Present exact staged changes for later publication approval.
4. Approve publication of that reviewed additive manifest, then verify real media and links read-only. Any asset deletion/retirement is excluded unless separately gated.
5. Separately authorize routine production maintenance: same app, media apply mode, daily maximum 25, no preferences/ratings changes or Telegram sends, no bulk legacy migration. Enabling a schedule that performs these operations is not inferred from code/push/deploy approval.

## Checks and Acceptance

- No cached DLC/add-on ID can bypass media identity validation; ambiguous match is skipped without guessed links or loss of last-known assets. Official [IGDB API fields](https://api-docs.igdb.com/#game) define platform, game type, parent, version and URL evidence.
- Missing media is processed without requiring a rating score or a Steam review snapshot. Nintendo six-image fixture and Steam HLS fixtures remain local deterministic evidence; real playback is checked only after approved production staging/publication.
- Max-25 selection, provider failures, retry timing and bounded concurrency are tested; enrichment failure cannot undo or duplicate Telegram delivery. Maintenance summaries distinguish acquisition from publication and validation failures.
- Required ETag/If-Match and 401/428/409 paths remain covered. Concurrent additive updates preserve unrelated records. No preferences endpoint is invoked by media maintenance.
- Direct-link close moves focus to search; card-opened close returns to its opener; removed/unfocusable opener uses browse fallback. 375px/1200px layouts and no-empty-media controls are checked locally.

Research created locally; not committed/pushed. Existing production remains implementation `2887f22`. No agent-facing instruction file changed. Reflection: separate render, acquisition and live-data acceptance gates; passing one must not be called full feature completion.
