# Use Case: Refresh Deal Intelligence

## Overview

**Use Case ID:** UC-004  
**Use Case Name:** Refresh Deal Intelligence  
**Primary Actor:** Automation Operator  
**Secondary Actors:** Daily Scheduler, Deal Data Providers  
**Goal:** Refresh complete, source-aware deal intelligence without publishing partial or destructive data.  
**Status:** Checkpoint recovery implemented and locally verified; production media staging is blocked on valid Twitch OAuth credentials
**Requirements:** [FR-009, FR-010](../requirements.md)

## Preconditions

Media maintenance supports explicit game ID/limit/incomplete-entry repair with dry-run by default. It merges provider assets rather than replacing sources, retains valid cached assets on errors, validates Steam identity independently of review scoring, and publishes additive updates with conditional revision checks. Unknown/unsafe media never becomes an arbitrary embed. Acquisition stays in the existing manual maintenance workflow.

Approved 2026-10-01: do not add a scheduled enrichment job. The existing media crawler validates IGDB game metadata before acquiring assets, treats legacy rating IDs as candidates, and records verified media identity without changing frozen ratings. Rejected or ambiguous identity cannot authorize new assets. Preserve raw legacy assets/associations for recovery and report incomplete acquisition. Full versus targeted production refresh is an explicit operator choice, not inferred from code deployment.

The operator subsequently confirmed full eligible catalog scope. `--all` revisits every eligible original-Switch game, not only missing/incomplete records; ordinary small runs retain their limit. Blocked titles and returned discounted prices above the existing cap are excluded. Snapshot acquisition must be complete and distinct before selecting eligible games. Publication remains conditional and additive, with reviewed recoverable association replacements.

Every crawler run uses a unique local SQLite checkpoint. The selected catalog and the provider identifiers used for the run are frozen at start. A game result and its per-provider completion status are committed before progress reports it as processed. Resume reuses committed results and retries only uncheckpointed games; retrying stored partial results is explicit. A provider exception is logged with its provider and safe exception class, commits that game's partial result as incomplete, and does not stop remaining providers or later games. The final manifest reports partial results; publication remains blocked until there are no incomplete or pending games. Export can reconstruct a partial manifest without contacting providers. This checkpoint protects against process and operating-system interruption, not loss of the host or disk.

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
7. System commits each game's merged result and provider status to the run checkpoint before reporting that game as processed; a provider exception is logged and marks only that provider/game incomplete while acquisition continues for remaining providers and games.
8. System produces a summary and a recoverable manifest with selected, checkpointed, complete, incomplete, and changed counts.
9. In publish mode, system applies only the exact previously staged manifest supplied by the operator, after validating it matches the complete checkpoint and current conditional revision; provider incompleteness or an exceeded payload limit prevents publication.
10. System records a completed or failed result that the operator can inspect or resume.

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

### A4: Crawler Process Interrupted

**Trigger:** The crawler exits before all selected games are processed (step 7)
**Flow:**

1. Results committed for earlier games remain in the run checkpoint.
2. The operator resumes the same run; metadata and selected catalog are validated before work continues.
3. Committed game IDs are loaded without provider requests; an uncommitted in-progress game is fetched again.
4. The system can export the partial checkpoint without performing provider requests or production writes.
5. Use case continues at step 7.

### A5: Provider Exception

**Trigger:** A provider request or parser raises while acquiring a game (step 7)
**Flow:**

1. The system records the provider, safe exception class, and partial merged result in the checkpoint; the affected game is marked incomplete.
2. It continues with remaining providers and games, then writes a manifest that includes the incomplete result.
3. Publication is refused until incomplete results are explicitly retried and the checkpoint is complete.

## Postconditions

### Success Postconditions

- Selected source snapshots are complete, validated, source-aware, and timestamped.
- The run summary explains all accepted and rejected records.
- Every selected game has a committed checkpoint result, including explicit partial-provider status.
- A provider exception cannot erase cached assets or permit publication of an incomplete run; it does not prevent other games from being processed.

### Failure Postconditions

- The last valid production snapshot remains available.
- The failure is visible with no credential-bearing provider reference.
- Results committed before the failure remain locally recoverable from the run checkpoint.

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
