# Use Case: Manage Game Preferences

## Overview

**Use Case ID:** UC-003  
**Use Case Name:** Manage Game Preferences  
**Primary Actor:** Deal Shopper  
**Goal:** Record a decision about a game and see the resulting preference state consistently across the tracker and Telegram.  
**Status:** Implemented - storage concurrency is not yet guaranteed  
**Requirements:** [FR-005](../requirements.md)

## Preconditions

- Shopper has access to the tracker.
- The selected game has a valid Nintendo identifier.

## Main Success Scenario

1. Shopper selects hide, reconsider, watch, unwatch, or remove from consideration for a game.
2. System validates the requested action and any price threshold.
3. System applies the action to the latest stored preference state.
4. System preserves every unrelated hidden, watched, and thinking entry.
5. System confirms the resulting state and updates the visible list.

Actions are available in both cards and detail dialogs using the same atomic endpoint. The dialog remains open when hiding removes its originating tile. Pending feedback is not saved-success feedback; failed actions expose retry and refresh authoritative state without dropping unrelated lists. Clicking the active watch threshold removes the watch. Focus returns to the original opener or a stable browse control if that opener disappears.

## Alternative Flows

### A1: Invalid Threshold

**Trigger:** Shopper requests a price threshold other than 2 EUR, 5 EUR, or 10 EUR (step 2)  
**Flow:**

1. System rejects the action and explains the allowed thresholds.
2. System leaves all preferences unchanged.
3. Use case ends.

### A2: Repeated Action

**Trigger:** The requested state already exists (step 3)  
**Flow:**

1. System keeps the existing state without creating a duplicate.
2. System confirms the unchanged resulting state.
3. Use case continues at step 5.

### A3: Preference Store Unavailable

**Trigger:** The latest preference state cannot be read or saved (step 3)  
**Flow:**

1. System reports that the action was not completed.
2. System does not replace existing preferences with an empty state.
3. Use case ends.

## Postconditions

### Success Postconditions

- The requested game has the selected preference state.
- Every unrelated preference remains present.

### Failure Postconditions

- No partial or empty preference document replaces the last valid state.
- The shopper sees that the action did not complete.

## Business Rules

### BR-001: Fixed Alert Thresholds

Watch actions accept only 2 EUR, 5 EUR, or 10 EUR.

### BR-002: Idempotent Actions

Repeating an action must be safe and must not create duplicate preference entries.

### BR-003: Hidden And Watched Digest Exclusion

A hidden or watched game is excluded from the curated daily digest.
