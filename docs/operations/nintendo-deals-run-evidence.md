# Nintendo Deals Run Evidence

## What Is Kept

- GitHub Actions keeps a public, redacted run artifact for 90 days. It includes per-stage metrics/timings, safe failure details, Nintendo catalog pages, the active catalog, and Nintendo Life source HTML plus per-entry match results.
- A private, immutable tar.gz copy is stored in Vercel Blob without automatic expiry. Alongside public source/run evidence, it contains the exact preferences, curation, rating, Steam, selected-game, offer-comparison, and official Nintendo price-hook inputs; Nintendo Life catalog candidates; watched-ID lookup outcomes; and IGDB search candidates/match decisions. It excludes credentials and chat identifiers. Hidden/watch/thinking preferences are included only in this private archive.
- A private `automation.run.summary` event is appended to the existing audit store. Every Telegram attempt/result from that run uses the exact same `gh-<run-id>-a<attempt>` correlation ID, so one exact audit filter returns the full run history.
- A run can be `partial` when an optional source lookup fails. Individual curation, watched-game, and IGDB lookup errors are recorded and do not suppress the rest of daily deal delivery. A complete source/catalog retrieval failure remains a failed run.
- GitHub's ordinary job logs remain available from the Actions run and include stdout/stderr. Never add secrets or private preference values to these logs; the repository is public.

## Inspect A Run

1. Find the run and its status:

   ```sh
   gh run list --workflow nintendo-deals-daily.yml --limit 20
   gh run view <run-id> --log
   ```

2. Download the convenient 90-day artifact:

   ```sh
   gh run download <run-id> --name nintendo-deals-run-<run-id>-attempt-<attempt> --dir run-evidence
   ```

3. Download the private no-expiry archive. Set `NINTENDO_DEALS_BASE_URL` and `RATINGS_API_KEY` in the local shell without printing the key:

   ```sh
   curl -fsS -G \
     -H "x-api-key: $RATINGS_API_KEY" \
     --data-urlencode "run_id=<run-id>" \
     --data-urlencode "run_attempt=<attempt>" \
     --data-urlencode "date=<UTC-date>" \
     "$NINTENDO_DEALS_BASE_URL/api/automation/runs" \
     -o nintendo-deals-run.tar.gz
   tar -tzf nintendo-deals-run.tar.gz
   ```

4. Find the permanent summary and Telegram history by date and correlation:

   ```sh
   curl -fsS -G \
     -H "x-api-key: $RATINGS_API_KEY" \
     --data-urlencode "date=<UTC-date>" \
     --data-urlencode "correlation_id=gh-<run-id>-a<attempt>" \
     --data-urlencode "limit=100" \
     "$NINTENDO_DEALS_BASE_URL/api/telegram/audit"
   ```

## Evidence Limits

- A run archive is immutable per GitHub run ID and attempt. Rerunning an upload for the same identity never overwrites the saved archive.
- Archives are read-only diagnostics. The private archive contains preference snapshots and decision inputs, but no app secrets or chat identifiers; it cannot be replayed against production by these commands. Public GitHub artifacts exclude all preference snapshots. If permanent archive or audit storage fails, the finalizer marks the GitHub run failed rather than silently treating logging as successful.
- Instrumentation was not present in the Oct 5 (`37345773549`) or Oct 6 (`37484147865`) runs. Their retained logs and summary show the worker failed at `deal_arrival_comparison` with HTTP 400 `Invalid or incomplete catalog`, before Telegram delivery. Those runs did not save the catalog pages, so the exact offending record cannot be recovered without a new run; no such run has been started.
