# Media Crawl Checkpoint Reliability

## Finding

The 2026-10-01 full crawl selected 2,825 of 2,911 distinct catalog records and logged 1,500 per-game results before stopping. Its log retained asset counts and a `complete` boolean, but the script kept merged media only in an in-memory `staged` dictionary and wrote the before/after manifest after the whole loop. No final manifest or completion record was produced. The termination cause is unconfirmed. See [the run record](../plans/2026-10-01-full-media-crawl.md#current-delivery-state) and [crawler staging and final write](../../scripts/media-backfill.py#L276).

Read-only production checks show all 1,500 logged game records still match the saved pre-run media snapshot. Two hundred had an older media entry, none had `collection_complete: true`, and 1,300 had no media entry. The crawl did not publish its in-memory results.

The existing `/api/media` write is an authenticated, conditional `If-Match` whole-map update. Storage merges screenshot and video arrays additively; publication is therefore distinct from acquisition and can remain behind manifest review. See [API validation and revision check](../../app/api/media/route.ts#L20) and [additive media merge](../../lib/media-storage.ts#L15).

## Durability Evidence

Python's standard-library `sqlite3` supports explicit transaction commit and rollback ([Python sqlite3 documentation](https://docs.python.org/3/library/sqlite3.html)). SQLite documents that WAL mode with `synchronous=FULL` performs an additional WAL sync at each transaction commit and provides durable transactions across system crashes, subject to filesystem and hardware behavior ([SQLite synchronous pragma](https://sqlite.org/pragma.html), [SQLite atomic commit](https://sqlite.org/atomiccommit.html)). This covers an interrupted crawler process and gives a stronger local-disk guarantee; it does not protect against loss of the host or disk.

Vercel documents a 4.5 MB limit for both Function request and response bodies ([Function limits](https://vercel.com/docs/functions/limitations)). The pre-crawl media snapshot was about 3.4 MiB, so the eventual publication and response sizes must be measured before any production apply. This limit does not affect writing or resuming the local checkpoint.

## Plan Implication

Use a per-run local SQLite checkpoint, commit each game result before logging it as finished, pin the selected catalog and input IDs to the run, and reconstruct a complete or partial manifest from the checkpoint without calling providers. Keep publication separate and conditional. A fresh full run must reacquire the earlier 1,500 games because their fetched media payloads were never persisted; only the progress counts remain.
