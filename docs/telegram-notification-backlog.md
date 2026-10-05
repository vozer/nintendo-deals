# Telegram Notifications: Closeout and Backlog

## Feature Status

The title images, additive Nintendo/Steam/Nintendo Life buttons, and initial new-deal arrivals are deployed in code commit `c2af080`. The later transition suppression, permanent private Telegram audit, and official offer-end-date display are implemented locally but not deployed. Requirements FR-013/014/015 and UC-005/006 are synchronized. This change performed no production sends, preference mutations, scraper runs, pushes, or deployments.

Implementation is complete; the validation items below remain open. Improvements are not silently included in the feature scope. These stable ND IDs are repository-local tracking IDs, not GitHub issues.

## Outstanding Items

| ID | Priority / Type | Finding and Evidence | Next Step / Acceptance |
|---|---|---|---|
| ND-001 | Resolved in local implementation | New, price-changed, re-entered offer messages and watched alerts now use permanent transition-state claim/result records independent of calendar day and preferences. Confirmed replays skip sends; unknown outcomes stop for operator review; a successful partial batch will not re-send an already-confirmed transition after a later run. | Verify the first natural production transition after an explicitly authorized deploy; preserve the no-history-flood baseline and never clear the event ledger to force sends. |
| ND-002 | Medium / Reliability improvement | Offer messages are paced within a batch, but pacing is not shared across offer and watched-alert sends. Telegram 429 responses are currently fatal; `retry_after` is not consumed. | Centralize pacing and bounded retries only for definite rate-limit rejection. A timeout must still stop for review rather than blindly resend. Verify with mocked 429 and timeout responses. |
| ND-003 | Medium / Operational improvement | The exception handler publishes failure stage/duration, not the partial counts accumulated earlier in `run()`. Dry-run baseline metrics describe the comparison candidate even though no snapshot is committed; dry runs use stored ratings rather than unpublished proposed enrichment. | Preserve sanitized partial counts on failure; clearly label planned versus committed baseline state and dry-run eligibility semantics. Never include tokens, raw URLs with credentials or user preference snapshots in artifacts. |
| ND-004 | Medium / Needs validation | First live execution initialized history, so no natural new arrival was sent. Local tests cover arrival/re-entry, no duplicate digest, send failure, replay and snapshot commit. | Inspect the next naturally occurring successful scheduled run with `new_deals > 0` and confirm received games/captions/source links. Zero arrivals is a valid daily outcome. No forced baseline deletion or historical flood. |
| ND-005 | Medium / Needs validation | A real photo preview succeeded; caption actions were verified locally. Live action testing was intentionally not automated because hide/watch actions alter user preferences. | Shopper uses a photo's Hide or Alert button on a game they actually want to act on; confirm acknowledgment, caption status, retained source buttons and app refresh. No synthetic production preference changes. |
| ND-006 | Low / Optional UX improvement | Every arrival is currently sent individually; a large sale or confidence update can generate a large batch. AbonoTeatro has more elaborate overflow handling. | If chat volume becomes problematic, agree a detailed-message cap plus a complete overflow digest; retain every eligible arrival rather than silently dropping capped items. |
| ND-007 | Low / Optional UX improvement | Caption callbacks escape Telegram-returned plain text, preserving content and buttons but not reconstructing original bold entities. No video/trailer button is added. | Preserve safe Telegram entity formatting if styling loss matters; consider a trailer link when valid cached media exists. Video uploads were not part of the requested title-image change. |
| ND-008 | Low / Optional preference improvement | Homepage tag exclusions are browser-local. Scheduled alerts share the canonical filter but cannot honor these local exclusions. | If server-synchronized tag preferences are desired, approve a backwards-compatible preference contract change and tests. Current arrival/history writes must not migrate or replace hidden/watch lists. |

Alert-action confirmations use a persistent chat reply with a separate permanent event claim/result. An ambiguous reply remains at-most-once and requires operator review; automatically retrying it is not claimed as implemented.

## Safe Operations

1. Inspect the failed GitHub step and redacted artifact before replaying. Distinguish new arrivals from watched-price thresholds; do not interpret `price_alerts: 0` as an empty Deals catalog.
2. If an arrival is claimed but unconfirmed, inspect the actual chat and identify the date/game before any recovery. A claim is not a delivery receipt; do not reset/delete the baseline or delivery ledger and do not edit user preferences to force a resend.
3. Any production recovery, scraper run, catch-up or test send requires explicit approval for its environment and run mode. Prefer read-only inspection and local synthetic reproduction first. Unknown delivery remains unresolved until reviewed.
4. First-run history cannot reconstruct yesterday's arrivals. The saved 104-game baseline is intentional; a future departure/re-entry counts as an arrival. GitHub may delay the 10:07 Madrid schedule.

## Verification Map

| Boundary | Deterministic Evidence | Production Evidence |
|---|---|---|
| Images, captions and source buttons | `automation/tests/test_nintendo_worker.py`, `test_telegram_delivery.py` | Future Knight photo preview accepted; source buttons present in the sent payload |
| Arrival delivery and baseline failure handling | `automation/tests/test_deal_arrivals.py` | Live non-dry-run execution 36731310379 initialized 104 IDs; natural arrival pending ND-004 |
| Offer transition replay, price changes/re-entry and watcher backstop | `app/api/telegram/deals/route.test.ts`, `automation/tests/test_deal_arrivals.py`, `automation/tests/test_catalog_fetch.py` | Not deployed; first natural production transition pending ND-004 |
| Permanent Telegram audit, secret redaction and filtered history | `app/api/telegram/audit/route.test.ts`, `app/api/telegram/webhook/route.test.ts` | Not deployed; API-key audit read and search not smoke-tested in production |
| Nintendo offer-end-date hook, exact-price matching and expiry display | `automation/tests/test_offer_end_dates.py`, `app/api/offer-end-dates/route.test.ts`, `lib/offer-end-dates.test.ts`, `automation/tests/test_deal_arrivals.py`, `e2e/game-deep-link.spec.ts` | Not deployed; production tile/message evidence pending |
| Eligibility, source trust, re-entry and snapshot authorization/conflicts | `app/api/telegram/deals/route.test.ts` | Authenticated worker comparison/commit succeeded; anonymous request returned 401 |
| Caption actions, persistence ordering, replay and denied actor | `app/api/telegram/webhook/route.test.ts` | Production caption mutation intentionally not performed; ND-005 |
| Read-only confirmation lookup and preference preservation | `app/api/telegram/deliveries/claim/route.test.ts` | Anonymous status read returned 401; all preference values exactly preserved |
| Deep links and accessible responsive dialogs | `e2e/game-deep-link.spec.ts` | Local synthetic tests at 375px and 1200px; no production browser mutations |

Local closeout: 75 TypeScript tests, 75 Python tests, lint, typecheck, AIUP documentation check, production build, and four Playwright cases passed. Browser tests used synthetic API fixtures and isolated temporary output. No production behavior was exercised by this closeout.
