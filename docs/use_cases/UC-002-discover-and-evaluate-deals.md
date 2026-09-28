# Use Case: Discover and Evaluate Deals

## Overview

**Use Case ID:** UC-002  
**Use Case Name:** Discover and Evaluate Deals  
**Primary Actor:** Deal Shopper  
**Secondary Actors:** Deal Data Providers  
**Goal:** Find a complete, distinct set of relevant Nintendo offers and inspect enough evidence to decide whether a game is worthwhile.  
**Status:** Implemented - audit found incomplete pagination and deep-link defects  
**Requirements:** [FR-002, FR-003, FR-004, FR-011](../requirements.md)

## Preconditions

- Shopper has access to the tracker.
- Nintendo catalog data is reachable.

## Main Success Scenario

1. Shopper opens the deal list.
2. System displays active offers with price, discount, confidence, and recommendation labels.
3. Shopper searches, filters, changes category, or changes sort order.
4. System displays distinct matching games and makes additional results available until all matches are represented.
5. Shopper selects a game.
6. System displays the game's description, price, media, ratings, source-specific editorial context, and available external review links.
7. Shopper opens an external store or review destination or closes the detail view.

## Alternative Flows

### A1: Direct Game Link

**Trigger:** Shopper opens a link containing a game identifier (step 1)  
**Flow:**

1. System finds the identified game even when it is outside the initial list.
2. System opens the detail view for that game.
3. Use case continues at step 6.

### A2: Enrichment Unavailable

**Trigger:** One or more rating, media, or editorial sources are unavailable (step 2)  
**Flow:**

1. System displays the Nintendo offer data that remains available.
2. System omits only the unavailable enrichment and does not present it as a negative rating.
3. Use case continues at step 3.

### A3: Catalog Unavailable

**Trigger:** Nintendo catalog data cannot be retrieved (step 2)  
**Flow:**

1. System displays a clear retryable error instead of an empty deal list.
2. Use case ends.

## Postconditions

### Success Postconditions

- Shopper has viewed a complete result set or a selected game's evidence.
- No shopper preference is changed unless UC-003 is started.

### Failure Postconditions

- No source outage is persisted as an empty enrichment map.
- Existing shopper preferences remain unchanged.

## Business Rules

### BR-001: Price Authority

Nintendo Europe determines Spanish availability and EUR price; secondary providers cannot override it.

### BR-002: Editorial Semantics

Nintendo Life selections are labelled as curated editorial choices, while NT Deals entries are labelled as deal picks and do not bypass review-confidence rules.

### BR-003: Deal Eligibility

An offer must have an actual discounted price no greater than 14.99 EUR and must not match the blocked-content rules.

### BR-004: Complete Pagination

The displayed collection must contain every distinct match reported by the catalog source or explicitly report that retrieval is incomplete.

