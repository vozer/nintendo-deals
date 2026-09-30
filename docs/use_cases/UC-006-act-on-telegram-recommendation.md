# Use Case: Act on Telegram Recommendation

## Overview

**Use Case ID:** UC-006  
**Use Case Name:** Act on Telegram Recommendation  
**Primary Actor:** Telegram User  
**Secondary Actors:** Telegram Service  
**Goal:** Open a recommended game or persist a hide or price-alert decision, receive a persistent alert reply, and see truthful state in the original message.

**Status:** Verified with local API contracts, including photo captions and replay; live photo action awaits shopper validation

**Requirements:** [FR-008](../requirements.md)

## Preconditions

- Telegram user and chat match the configured shopper identity.
- The game message contains a supported action.

## Main Success Scenario

1. Telegram user selects Show, Nintendo, Steam and Nintendo Life (each when available), Hide, Alert 2 EUR, Alert 5 EUR, or Alert 10 EUR.
2. For Show, system opens the tracker at the selected game's detail view. Nintendo/Steam/Nintendo Life buttons open their source destinations without mutating preferences.
3. For a preference action, system validates the sender, chat, action, game identifier, and threshold.
4. System applies the action to the latest preference state.
5. System confirms completion to Telegram only after persistence succeeds.
   For Alert actions, send a persistent chat message such as `Future Knight Alert for <5€ set`, with Show targeting `/?game=<fs_id>` and all source URL buttons retained. Confirmation replies omit mutating buttons. Acknowledge the callback silently to clear Telegram's spinner; do not use a temporary toast as the alert confirmation. Hide confirmations are unchanged.
6. System edits text via `editMessageText` or photo captions via `editMessageCaption` to show the resulting hidden or alert state, retaining the existing inline keyboard and source destinations.

## Alternative Flows

### A1: Unauthorized Actor

**Trigger:** Sender or chat does not match the configured shopper identity (step 3)  
**Flow:**

1. System rejects the action without changing preferences.
2. System records the rejected actor check without disclosing preference data.
3. Use case ends.

### A2: Duplicate Delivery

**Trigger:** Telegram delivers an update that has already completed (step 3)  
**Flow:**

1. System returns the previously completed result without applying another state change.
2. Use case ends.

### A3: Persistence Failure

**Trigger:** Preference state cannot be read or saved (step 4)  
**Flow:**

1. System reports that the action failed rather than showing success.
2. System retains the original message actions for retry.
3. Use case ends.

### A4: Message Edit Failure

**Trigger:** Preference persistence succeeds but the original message cannot be edited (step 6)  
**Flow:**

1. System keeps the persisted preference result.
2. System reports a delivery failure that can be safely retried without another state change.
3. Use case ends.

## Postconditions

### Success Postconditions

- The selected preference state is stored exactly once.
- The Telegram message reflects the persisted state or the tracker opens the selected game.

### Failure Postconditions

- Unauthorized or invalid actions change no preference.
- A failed persistence attempt is not presented as a success.

## Business Rules

### BR-001: Actor Validation

Only the configured chat and user may mutate preferences from Telegram.

### BR-002: Persist Before Success

Success feedback is allowed only after the preference store confirms the action.

### BR-003: Replay Safety

Repeated delivery of one Telegram update must not create an additional state change.

Persistent alert replies use separate claim/confirmed markers in the bounded internal Telegram replay metadata. A repeated callback may repair the original message edit but must not send a second confirmed chat reply. An unconfirmed reply claim fails visibly for operator review instead of silently succeeding or blindly resending after an ambiguous timeout. A new deliberate click (new callback ID), including an already configured threshold, receives its own confirmation. No preference API shape changes or existing-list migration are required.

Telegram permits [silent callback acknowledgment](https://core.telegram.org/bots/api#answercallbackquery) by omitting notification text. Persistent success uses `sendMessage`, not that temporary notification channel.

### BR-004: Message Context

An edited message retains the title, price, explanation, source context, store destination, and available actions. Returned Telegram text/captions are HTML-escaped before editing. Bold styling is not reconstructed from Telegram entities (ND-007); content and destinations are preserved.
