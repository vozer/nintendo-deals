# Use Case: Deliver Daily Notifications

## Overview

**Use Case ID:** UC-005  
**Use Case Name:** Deliver Daily Notifications  
**Primary Actor:** Daily Scheduler  
**Secondary Actors:** Telegram Service, Deal Shopper  
**Goal:** Deliver truthful offer-transition notices, watched price alerts, and eligible editorial picks from complete current data without repeating unchanged offers.
**Status:** Deployed notification baseline; locally implemented transition, audit, and expiry increments pending release

**Requirements:** [FR-006, FR-007, FR-010, FR-012, FR-013, FR-014, FR-015](../requirements.md)

## Daily Deal Arrivals and Rich Messages (2026-09-30)

- FR-012/FR-014: Compare complete daily original-Switch offer snapshots independently from preferences. Notify eligible new, changed-price, and re-entered offers; a stable offer is never repeated on a later date. Reuse homepage classification, confidence, Steam-tag and shovelware rules, excluding hidden, watched and thinking games. Browser-only tag exclusions are not persisted and cannot affect scheduled selection.
- Initialize the first snapshot without historical catch-up because no previous eligible snapshot exists (same baseline policy as AbonoTeatro). Commit the snapshot only after successful delivery; conditional writes reject stale workers. Store this history separately from preferences.
- Watched threshold alerts remain distinct from new-deal arrivals. Daily metrics report both. Games sent as new arrivals are not also sent in that run's curated digest.
- Send the available Nintendo title image using `sendPhoto`, with a bounded HTML caption retaining title, price, description, eligibility explanation and action status. Without an image, send text. Only an explicit Telegram image-rejection response permits text fallback; timeouts must not cause ambiguous duplicate sends.
- Link buttons are additive: retain Show (app deep link), Nintendo, and every available Steam/Nintendo Life destination. This supersedes the earlier Steam-replaces-Nintendo-Life policy. Steam remains available for non-curated games; do not invent matches or scrape providers during delivery. Hide/watch callbacks retain source links and restore Show if missing. Persistent Alert confirmations retain Show and available URL buttons, but omit mutating buttons to avoid recursive confirmations.
- Existing daily delivery claims remain at-most-once: an ambiguous Telegram failure requires operator review, not a blind resend. No hidden/watch preference migration is permitted.
- New-deal deliveries also record a confirmed-send marker; replay may advance the snapshot only when each existing claim has a confirmed send. Unconfirmed claims stop the run without committing its baseline.
- An offer event is keyed by game, active-discount episode, price-change sequence, and current price. A complete crawl that omits a game closes its episode; a later return starts another. Price changes inside an episode create a new event. Identical consecutive observations never create another message, regardless of calendar date or notification category.
- First-run and legacy-snapshot migration initializes offer state quietly. This deliberately favors avoiding duplicate historical offers over replaying uncertain notifications from before the transition snapshot existed.
- An official Nintendo `discount_price.end_datetime` may be shown only when present and when the record matches the current discounted price. Missing/invalid/stale hook data is omitted; no source date is inferred.
- Every accepted inbound Telegram update, rejected actor action, persisted result, and outbound Bot API attempt/result is appended to private immutable audit records with no automatic expiry. API-key-protected reads are bounded and paginated, with date, direction, kind, correlation, and text filters; bot tokens and webhook secrets are redacted.

Telegram contract: [sendPhoto](https://core.telegram.org/bots/api#sendphoto), [editMessageCaption](https://core.telegram.org/bots/api#editmessagecaption).

## Preconditions

- Daily delivery is configured for the shopper's Telegram destination.
- Current preferences and validated source data are available.

## Main Success Scenario

1. Scheduler starts the daily run within the Madrid delivery window.
2. System retrieves the complete active Nintendo offer set and the latest valid preferences/editorial snapshots; watched IDs are also queried directly as an alert backstop.
3. System identifies watched games whose actual discounted price is below their threshold.
4. System identifies up to ten active Nintendo Life selections that are neither hidden nor watched, for editorial context on otherwise eligible offer transitions.
5. System compares current discounted offers with the last complete snapshot by ID and price; new, changed-price, and re-entered offer events are selected without replaying unchanged offers. Missing or legacy history establishes a quiet baseline. Homepage eligibility still excludes hidden, watched and thinking games; the curated path applies its own existing filters.
6. System builds image/caption messages where possible, with the Nintendo button, every available Steam/Nintendo Life button, and hide/watch actions.
7. System sends at most one offer message per game transition, plus a watched price alert only once for the same game/offer state. Stable curated games are not re-sent on later days; qualifying curated games may explain a new, changed, or re-entered event. A watch alert requires an explicitly discounted current offer.
8. System commits the new snapshot only after all delivery stages succeed and confirmed delivery records are durable.
9. System records successful counts separately for eligible deals, new/changed/re-entered events, watched alerts and curated messages; a failed run records its failure stage and duration. Every inbound/outbound Telegram exchange is retained for operator review.

## Alternative Flows

### A1: No Eligible Notification

**Trigger:** No new arrival, watched threshold crossing or editorial selection is eligible

**Flow:**

1. System sends no game message.
2. System records a successful run with zero eligible notifications.
3. System still commits the successfully evaluated snapshot and records the run summary.

### A2: Incomplete Catalog

**Trigger:** Retrieved offer count does not equal the catalog-reported count (step 2)  
**Flow:**

1. System sends no notification based on the partial collection.
2. System records an incomplete-run failure with both counts.
3. Use case ends.

### A3: Telegram Delivery Failure

**Trigger:** Telegram rejects or times out while sending a message (step 7)

**Flow:**

1. An explicit image-rejection response permits a text fallback; other errors stop the run without a blind resend.
2. System records the failure stage without exposing credentials and does not advance the snapshot.
3. A replay can skip any previously confirmed offer-transition send, independent of calendar date. A permanent claim without a confirmed result is an unknown outcome and stops for operator review; the system does not blindly resend it or commit an incomplete snapshot.
4. See ND-001 and ND-002 in the [backlog](../telegram-notification-backlog.md) for recovery and rate-limit improvements.

## Postconditions

### Success Postconditions

- Every eligible notification is sent once for its stable offer-event identity or skipped because that same identity is already confirmed. A pending or ambiguous send is not retried blindly.
- Hidden and watched games do not appear in the curated digest.

### Failure Postconditions

- A partial catalog does not generate a misleading digest.
- The run history records the failed stage; partial per-message counts are a tracked operational improvement (ND-003).

## Business Rules

### BR-001: Daily Schedule

The workflow declares one timezone-aware 10:07 Europe/Madrid schedule. A delayed GitHub event is processed when delivered rather than discarded by a current-time window check.

### BR-002: Alert Comparison

A watched game alerts only when its actual discounted price is strictly below the selected threshold.

### BR-003: Digest Eligibility

The digest contains at most ten active Nintendo Life selections and excludes hidden, watched, blocked, and ineligible-price games.

### BR-004: Complete Destinations

Every store reference in a message is an absolute destination that can be opened directly. Relative eShop paths are resolved against `https://www.nintendo.com/` before the message is sent.

### BR-005: Preserve Preferences During Delivery Claims

Delivery claims preserve hidden, watched, and thinking preferences. Conditional preference writes use the strong ETag from an uncompressed origin read; weak ETags from compressed responses cannot be used for write preconditions.
