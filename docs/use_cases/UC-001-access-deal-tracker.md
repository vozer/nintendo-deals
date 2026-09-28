# Use Case: Access Deal Tracker

## Overview

**Use Case ID:** UC-001  
**Use Case Name:** Access Deal Tracker  
**Primary Actor:** Visitor  
**Goal:** Gain authorized access to the private deal tracker without exposing shopper state to an unauthenticated visitor.  
**Status:** Tested  
**Requirements:** [FR-001](../requirements.md)

## Preconditions

- The tracker has one configured access credential.
- The visitor is not currently authenticated.

## Main Success Scenario

1. Visitor opens the deal tracker.
2. System displays the access form and retains the originally requested destination.
3. Visitor enters the configured credential.
4. System verifies the credential.
5. System grants access and opens the originally requested destination.

## Alternative Flows

### A1: Invalid Credential

**Trigger:** The entered credential does not match the configured credential (step 4)  
**Flow:**

1. System denies access and displays an error.
2. System leaves the requested destination unchanged.
3. Use case continues at step 3.

### A2: Already Authenticated

**Trigger:** The visitor already has a valid authenticated session (step 1)  
**Flow:**

1. System opens the requested destination without displaying the access form.
2. Use case ends.

## Postconditions

### Success Postconditions

- The visitor has an authenticated session.
- The requested tracker destination is displayed.

### Failure Postconditions

- The visitor remains unauthenticated.
- No shopper preference is changed.

## Business Rules

### BR-001: Private Tracker

The main tracker and individual game views require the configured shopper credential.

### BR-002: Destination Preservation

Authentication must preserve the requested game deep link so the shopper reaches the intended game after access is granted.

