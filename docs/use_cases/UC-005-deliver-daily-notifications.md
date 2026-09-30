# Use Case: Deliver Daily Notifications

## Overview

**Use Case ID:** UC-005  
**Use Case Name:** Deliver Daily Notifications  
**Primary Actor:** Daily Scheduler  
**Secondary Actors:** Telegram Service, Deal Shopper  
**Goal:** Deliver truthful daily price alerts and a concise editorial digest from complete current data.  
**Status:** Deployed; live baseline/image delivery verified, first natural arrival pending validation

**Requirements:** [FR-006, FR-007, FR-010, FR-012](../requirements.md)

## Daily Deal Arrivals and Rich Messages (2026-09-30)

- FR-012: Compare complete daily eligible Deals snapshots; notify games newly entering or re-entering the homepage Deals selection. Reuse the homepage classification, confidence, Steam-tag and shovelware rules, excluding hidden, watched and thinking games. Browser-only tag exclusions are not persisted and cannot affect scheduled selection.
- Initialize the first snapshot without historical catch-up because no previous eligible snapshot exists (same baseline policy as AbonoTeatro). Commit the snapshot only after successful delivery; conditional writes reject stale workers. Store this history separately from preferences.
- Watched threshold alerts remain distinct from new-deal arrivals. Daily metrics report both. Games sent as new arrivals are not also sent in that run's curated digest.
- Send the available Nintendo title image using `sendPhoto`, with a bounded HTML caption retaining title, price, description, eligibility explanation and action status. Without an image, send text. Only an explicit Telegram image-rejection response permits text fallback; timeouts must not cause ambiguous duplicate sends.
- Nintendo and Nintendo Life destinations are inline URL buttons (the latter only when a matched source URL exists), not raw body URLs. Hide/watch callbacks update either text or photo captions after persistence, preserving source buttons.
- Existing daily delivery claims remain at-most-once: an ambiguous Telegram failure requires operator review, not a blind resend. No hidden/watch preference migration is permitted.
- New-deal deliveries also record a confirmed-send marker; replay may advance the snapshot only when each existing claim has a confirmed send. Unconfirmed claims stop the run without committing its baseline.

Telegram contract: [sendPhoto](https://core.telegram.org/bots/api#sendphoto), [editMessageCaption](https://core.telegram.org/bots/api#editmessagecaption).

## Preconditions

- Daily delivery is configured for the shopper's Telegram destination.
- Current preferences and validated source data are available.

## Main Success Scenario

1. Scheduler starts the daily run within the Madrid delivery window.
2. System retrieves the complete active Nintendo offer set and the latest valid preferences and editorial snapshot.
3. System identifies watched games whose actual discounted price is below their threshold.
4. System identifies up to ten active Nintendo Life selections that are neither hidden nor watched.
5. System compares homepage-eligible games with the last successful snapshot, excluding hidden, watched and thinking games. Missing history establishes a quiet baseline.
6. System builds image/caption messages where possible, with Nintendo and available Nintendo Life buttons and hide/watch actions.
7. System sends new arrivals, watched threshold alerts, and up to ten digest candidates, excluding arrivals from that run's digest.
8. System commits the new snapshot only after all delivery stages succeed.
9. System records successful counts separately for eligible deals, new arrivals, watched alerts and digest messages; a failed run records its failure stage and duration.

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
3. Same-day replay can skip confirmed new-deal sends, but an unconfirmed claim stops for operator review. Daily claim keys alone do not prove successful delivery.
4. See ND-001 and ND-002 in the [backlog](../telegram-notification-backlog.md) for recovery and rate-limit improvements.

## Postconditions

### Success Postconditions

- Every eligible notification is sent or skipped by the daily replay guard; detected delivery errors fail the run. A prior watched-alert or digest claim is not proof of successful delivery (ND-001).
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
