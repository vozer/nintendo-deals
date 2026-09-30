# Use Case: Deliver Daily Notifications

## Overview

**Use Case ID:** UC-005  
**Use Case Name:** Deliver Daily Notifications  
**Primary Actor:** Daily Scheduler  
**Secondary Actors:** Telegram Service, Deal Shopper  
**Goal:** Deliver truthful daily price alerts and a concise editorial digest from complete current data.  
**Status:** Implemented - audit found catalog truncation and schedule fragility  
**Requirements:** [FR-006, FR-007, FR-010](../requirements.md)

## Preconditions

- Daily delivery is configured for the shopper's Telegram destination.
- Current preferences and validated source data are available.

## Main Success Scenario

1. Scheduler starts the daily run within the Madrid delivery window.
2. System retrieves the complete active Nintendo offer set and the latest valid preferences and editorial snapshot.
3. System identifies watched games whose actual discounted price is below their threshold.
4. System identifies up to ten active Nintendo Life selections that are neither hidden nor watched.
5. System builds one informative message per selected game with a full store destination and available actions.
6. System sends each price alert and digest message through Telegram.
7. System records counts for offers, alerts, digest items, sent messages, and failures.

## Alternative Flows

### A1: No Eligible Notification

**Trigger:** No watched game meets its threshold and no editorial selection is eligible (step 4)  
**Flow:**

1. System sends no game message.
2. System records a successful run with zero eligible notifications.
3. Use case continues at step 7.

### A2: Incomplete Catalog

**Trigger:** Retrieved offer count does not equal the catalog-reported count (step 2)  
**Flow:**

1. System sends no notification based on the partial collection.
2. System records an incomplete-run failure with both counts.
3. Use case ends.

### A3: Telegram Delivery Failure

**Trigger:** Telegram rejects or times out while sending a message (step 6)  
**Flow:**

1. System retries within the configured bound.
2. System records the final failed message without exposing credentials.
3. Use case continues at step 7.

## Postconditions

### Success Postconditions

- Every eligible notification is sent once for the run or is explicitly counted as failed.
- Hidden and watched games do not appear in the curated digest.

### Failure Postconditions

- A partial catalog does not generate a misleading digest.
- The run history shows why delivery did not complete.

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
