# Full Production Media Crawl

## Approved Scope

On 2026-10-01 the user confirmed the full currently eligible original-Switch catalog, rather than the two previously investigated games. Use the existing media crawler; no new scheduler/job/service. Preserve all cached assets, hidden/watch/Thinking items, frozen ratings and Telegram state. No asset removal, credential rotation or production code deployment is included.

The existing CLI small-run cap prevented this scope, so an explicit `--all` flag was added in place. It revisits complete existing records, rather than repeatedly selecting the first missing/incomplete batch. A deterministic CLI test proves cap bypass, existing-complete refresh and exclusion of blocked/over-cap records; 13 focused media tests pass. Requirements and UC-004 were synchronized before implementation.

## Execution

- Target: `https://nintendo-deals.vercel.app`.
- Mode: real full-catalog acquisition and exact before/after staging, with no API writes during acquisition. Publication requires reviewed recoverable association changes and a current If-Match revision.
- Existing script: `scripts/media-backfill.py --base-url https://nintendo-deals.vercel.app --all --run-dir <new-run-directory>`.
- Actual complete distinct source catalog: 2,911 records. Selected: 2,825 eligible games after content/returned-price filtering. Nintendo source query retains the existing digital, English-availability, active-sale, original-Switch and 14.99 EUR cap criteria.
- Baseline media map: 2,495 records. Preference baseline: 157 hidden, 11 watched, four Thinking.
- Crawler process: PID 9740, owned by execution session 14607. No other scraper was dispatched.
- Non-overwriting recovery/data directory: `/Users/benjamin/Documents/private_workspace/nintendo-deals/output/media-full-refresh-2026-10-01-2fwAYm/`.
- `media-before.json`: complete recovery snapshot of the pre-run media map, approximately 3.4 MiB.
- `protected-snapshot-hashes.json`: hashes of preferences, ratings and Steam maps, not credentials or session state.
- `crawl.log`: per-record progress/provider error classes. Partial collection is not treated as a guessed provider identity; cached assets remain.
- `process.json`: start time, PID, target and acquisition mode. `completion.json` is written by the supervisor on exit. `staged-manifest.json` is emitted only on successful completion of acquisition.

## Current Delivery State

Checked at 2026-10-01 09:53 Europe/Madrid: the crawler and its supervisor are no longer running, and execution session 14607 is unavailable. The log ends at 1,500/2,825 around 01:34, without a recorded exception. Neither `completion.json` nor `staged-manifest.json` exists. The termination cause is unconfirmed; do not label this a provider failure or a successful completion.

The original crawler retained acquired records in memory until its final output write, so the partial results are not recoverable from the progress log. A crash-safe replacement is now implemented in the existing CLI: each result and provider status is durably committed to a local SQLite checkpoint before progress is reported. The frozen selection and snapshots can be resumed or exported without re-querying the catalog. An in-progress, uncommitted game is reacquired. Provider exceptions are recorded on the affected game, whose partial assets are preserved; acquisition continues for other providers and games. Publication is a separate `--resume <run-dir> --apply --apply-manifest <reviewed-file>` action; the file must exactly match the checkpoint, and pending or incomplete results are rejected.

The new full run must use a process lifetime independent of the interactive execution session. No new scheduler or service is required. Exact counts, provider coverage, changed/unchanged records, payload bytes and removed-assets invariant remain pending until the new staged acquisition completes and is validated.

Read-only production checks returned HTTP 200 for media, preferences, ratings and Steam. All four snapshots match their pre-run baselines exactly. No production publication occurred. The original recovery snapshot and progress log remain intact.

Application/CLI/spec changes are local and uncommitted/unpushed. Production still runs implementation `2887f22`. Production media has not been published by this run; no lists/ratings/Telegram writes occurred.

## Crash-Safe Recovery Implementation and Restart Attempt

The existing CLI now uses a unique local SQLite checkpoint (`WAL`, `synchronous=FULL`) with a process lock. It freezes the catalog selection, initial media map/revision, and per-game provider IDs; commits each merged game and provider status before progress; resumes only missing games by default; explicitly retries saved partials; and exports partial manifests without provider calls. Provider exceptions save the affected game's partial result and allow remaining providers and games to continue; incomplete records still block publishing. Publishing requires a separate `--resume ... --apply --apply-manifest <reviewed-file>` invocation, exact manifest/checkpoint equality, a complete run, the frozen API revision, and Vercel request/projected-response size preflight. Checkpoints are ignored under `output/media-crawls/`; prior output artifacts were left intact.

- Local evidence: `python -W error::ResourceWarning -m unittest automation.tests.test_media_backfill` passed 22 tests, including forced process kill/resume, SQLite integrity, exclusive run lock, metadata mismatch, failed transaction rollback, fail-fast provider error, export-only without network, explicit partial retry, exact reviewed-manifest enforcement, successful mocked apply, and oversized Vercel response rejection before write.
- Repository evidence: `python -m unittest discover -s automation/tests -p 'test*.py'` passed 69 tests; `npm run check:aiup`, CLI help, Python compilation, and `git diff --check` passed.
- A new production-targeted acquisition-only attempt froze 2,670 distinct Nintendo records and selected 2,577 eligible games. Its first Twitch OAuth request returned HTTP 400 before game 1. This was later traced to the local stdin wrapper preserving newline characters on the two credential lines; the initial conclusion that the supplied Twitch app credentials were invalid was incorrect. A masked direct OAuth check with the same user-provided pair returned HTTP 200 and an access token. No token or credential was persisted or printed.
- Recovery artifact: `output/media-crawls/full-refresh-a2aab9ec3b0c/`. The authoritative `checkpoint.sqlite3` integrity check is `ok`; the initial `staged-manifest.json` records the pre-resume state (0/2,577) and is stale while a worker is running. Current progress is read from the SQLite checkpoint. No preferences endpoint is used by the crawler, so hidden/watch state was not read or changed.
- The exact frozen selection resumed without re-fetching the production catalog/snapshots. No credential was rotated, committed, or written to disk.

### Credential Correction, Fail-Fast Fix, and Resume

- The first correctly formatted Twitch OAuth check using the already-provided pair succeeded (HTTP 200). The prior `invalid client` result came from this operator's over-escaped newline trimming, not from the user's credentials.
- The checkpointed run initially processed 40 games. While investigating incomplete results, code review found `fetch_igdb_media` swallowed IGDB request exceptions and returned `collection_complete=False`; this let the outer crawler continue instead of using its existing stop-on-provider-error handler. The run was intentionally interrupted after per-game commits; SQLite integrity remained `ok` and those 40 records were preserved.
- Removed that inner exception suppression and changed the regression test to require the original provider exception to propagate. The test failed before the fix and passed after it. Ordinary no/ambiguous IGDB identity remains a recorded incomplete match, not an exception.
- The first corrected run stopped at game 3128067, Dragonheart Blade, after Steam search raised `RuntimeError`. It staged 1,291/2,577 records (1,028 complete, 263 incomplete, 1,286 pending) to `staged-manifest-2.json`; Nintendo and IGDB media for that game were preserved. The Steam wrapper had replaced the original network exception with generic `Steam search unavailable`, so its exact cause is unknown. One subsequent read-only request to the same Steam search endpoint returned HTTP 200 and valid empty results. No production data was written.
- After that diagnosis, the same frozen run resumed with `--retry-incomplete` under PID 6608. It was intentionally interrupted to change the provider-error policy; the durable checkpoint then held 1,314/2,577 records (1,049 complete, 265 incomplete, 1,263 pending), with SQLite integrity `ok`. Its interrupted in-flight game will be retried. Log: `/tmp/nintendo-deals-media-resume-a2aab9ec3b0c-retry2.log` (mode 0600). No `--apply` was used; no production media, preferences, hidden/watch state, ratings, Steam data, or Telegram state was written.
- After changing the policy and passing the focused regression plus the 22 media tests, 69 automation tests, AIUP check, Python compilation, and diff check, the same run was restarted with `--retry-incomplete` under PID 10617. It began from the 1,314-record checkpoint; SQLite integrity is `ok`. Log: `/tmp/nintendo-deals-media-resume-a2aab9ec3b0c-retry3.log` (mode 0600). The worker is active. No `--apply` was used and no production API data was written.
- An inspection typo opened the wrong filename and created a zero-byte `output/media-crawls/full-refresh-a2aab9ec3b0c/checkpoint.sqlite`; the actual `checkpoint.sqlite3` was unaffected. The empty sidecar is being left untouched rather than deleted without the required exact cleanup approval.
- No GitHub workflow, production code deployment, or production data write occurred.

## Completion Gates

Require exit code zero and a full staged manifest. Validate every entry, distinct selected-game coverage and zero removed cached assets. Confirm exact changed fields and retained counterparts, serialized counts/bytes, named recovery snapshot and current revision. Provider exceptions require diagnosis, not blind continuation or publication of a false-complete snapshot. Review the exact association-replacement manifest before publication. Preserve all unrelated map keys via the existing conditional additive API. Check public reads and actual selected-game links/media after authorized publication; compare protected preferences before/after. Any concurrent ratings changes must be attributed to independent workers rather than claimed as crawler writes.

Do not delete this recovery/staging directory during the run or before repair acceptance. Do not commit raw artifacts or any local environment/secret/session file.
