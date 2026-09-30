# Use Case: Refresh Deal Intelligence

## Overview

**Use Case ID:** UC-004  
**Use Case Name:** Refresh Deal Intelligence  
**Primary Actor:** Automation Operator  
**Secondary Actors:** Daily Scheduler, Deal Data Providers  
**Goal:** Refresh complete, source-aware deal intelligence without publishing partial or destructive data.  
**Status:** Implemented - audit found source and completeness defects  
**Requirements:** [FR-009, FR-010](../requirements.md)

## Preconditions

- Required provider credentials are configured for the selected refresh mode.
- A previous valid enrichment snapshot may exist.
- Standalone refresh scripts resolve repository modules without relying on an ambient `PYTHONPATH`.

## Main Success Scenario

1. Operator or scheduler starts a refresh in dry-run or publish mode.
2. System validates required configuration and identifies the selected source jobs.
3. System retrieves every page required by each selected source contract.
4. System validates item counts, required fields, provenance, and title matches.
5. System separates authoritative price data, editorial selections, deal picks, ratings, reviews, and media according to source policy.
6. System produces a run summary with fetched, matched, rejected, refresh-eligible, frozen, and changed counts.
7. In publish mode, system replaces only a complete validated snapshot or applies an atomic item update.
8. System records a completed or failed result that the operator can inspect.

## Alternative Flows

### A1: Dry Run

**Trigger:** Operator selects dry-run mode (step 1)  
**Flow:**

1. System performs retrieval, validation, matching, and summary generation.
2. System writes no production preference or enrichment data and sends no message.
3. Use case continues at step 8.

### A2: Source Contract Drift

**Trigger:** A source returns an unexpected structure or an implausible item count (step 4)  
**Flow:**

1. System marks the source job failed and retains the previous valid snapshot.
2. System reports the source, validation failure, and observed count without exposing credentials.
3. Use case ends.

### A3: Ambiguous Title Match

**Trigger:** More than one provider candidate meets the title-only match condition or the best match lacks supporting platform evidence (step 4)  
**Flow:**

1. System rejects the enrichment candidate rather than attaching uncertain evidence.
2. System increments the ambiguous-match count.
3. Use case continues at step 5.

## Postconditions

### Success Postconditions

- Selected source snapshots are complete, validated, source-aware, and timestamped.
- The run summary explains all accepted and rejected records.

### Failure Postconditions

- The last valid production snapshot remains available.
- The failure is visible with no credential-bearing provider reference.

## Business Rules

### BR-001: Source Authority Split

Nintendo owns price and availability, Nintendo Life owns editorial selection, IGDB and Steam provide review evidence, and secondary deal sites provide discovery signals only.

### BR-002: Fail Closed On Partial Data

An empty, truncated, or structurally invalid retrieval cannot replace a previously non-empty valid snapshot.

### BR-003: Bounded Provider Use

Provider requests use explicit timeouts, bounded retries, and documented rate limits.

### BR-004: Age-Gated Rating Refresh

Rating refresh selects missing entries and existing entries for games released less than two months ago. Once a game is at least two months old, its first successful IGDB match is retained without routine refresh.

Ratings publication accepts both historical percentage match confidence (0–100) and worker fraction confidence (0–1). Existing values are preserved without migration; confidence outside 0–100 is rejected.

### BR-005: Original Switch Scope

Catalog processing includes original Nintendo Switch games and explicitly excludes records tagged as Nintendo Switch 2.
