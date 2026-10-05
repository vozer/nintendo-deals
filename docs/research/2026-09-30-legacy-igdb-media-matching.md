# Legacy IGDB Media Association: Blaster Master Zero

Research only, 2026-09-30. Local source baseline: `e72fba4ef501c4103e7cde12f0e042208e992e1e`. Public observations made during this session; final evidence collection at `2026-09-30T21:52:45Z`. No implementation, production scraper (including dry-run), authenticated provider calculation, preference write, commit, push, or deployment occurred. Only this research file is in write scope. Existing dirty instructions, release notes, browser artifacts, and the parent's separate research remain untouched.

## Conclusion

Nintendo ID `1204623` is the base game **Blaster Master Zero**, but its cached rating identifies **Blaster Master Zero: EX Character - Shantae**, IGDB ID `171205`. Historical media acquisition trusted the rating ID without checking game identity, preferred that record's YouTube videos over Nintendo videos, and manufactured an IGDB slug from the rating title. That combination explains the observed base-game screenshots, add-on link, and update trailer. Current acquisition still trusts the cached rating ID; additive merges preserve the old video even if a corrected source URL is supplied. [S1][S2][S3][S4][S5][S6]

**Exact boundary of certainty:** the persisted incorrect association and the historical/current propagation mechanisms are proven. The historical URL was constructed from a matched title, not retrieved from an IGDB game-ID lookup. The current rating ID `171205` corroborates the present Shantae association but does not prove which ID was used when the March media record was written. The original March rating-selection algorithm, provider candidate ordering, execution log, and exact writer of this stored record are not available in the inspected repository history. Therefore the initial reason a Shantae match won, including why confidence was `100`, remains unknown. Do not claim that the current matcher created the March record. [S2][S4][S7]

## Public Evidence

| Source | Observed result |
| --- | --- |
| Public production `GET /api/media`, key `1204623` | Six Nintendo screenshots; one YouTube video `VCKtO0HTgAk`, named `Trailer`; `igdb_url=https://www.igdb.com/games/blaster-master-zero-ex-character---shantae`; `source=nintendo`; `last_updated=2026-03-07`. No per-video source, match evidence, or completeness marker. |
| Public production `GET /api/ratings`, same key | `igdb_id=171205`; `matched_title=Blaster Master Zero: EX Character - Shantae`; `confidence=100`; all three scores null; both counts zero; `last_updated=2026-03-07`. |
| Exact-ID Nintendo ES Solr GET | `numFound=1`; both titles `Blaster Master Zero`; publisher `Inti Creates`; original Switch download software; release `2017-03-09`; Nintendo page ends `Blaster-Master-Zero-1204623.html`. |
| YouTube public oEmbed GET for the cached video | Title `Blaster Master Zero Version 1.3 Update - Official Trailer`; author `INTI CREATES`, channel `https://www.youtube.com/@inticreates`. |

Sources: [S1][S2][S3][S8]. The video is official **update footage for the base game**, not proven unrelated or malicious content. Its existence on an add-on-associated acquisition path is not, by itself, grounds to delete it. Treat the wrong game identity as confirmed; whether to retain this update trailer as labelled supplemental footage is a separate approval decision. The public metadata does not prove the precise historical IGDB video-to-game relation.

Read-only reproduction commands used (no headers, credentials, or writes):

```sh
curl -fsS https://nintendo-deals.vercel.app/api/media | jq '."1204623"'
curl -fsS https://nintendo-deals.vercel.app/api/ratings | jq '."1204623"'
curl -fsS 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DVCKtO0HTgAk&format=json' |
  jq '{title,author_name,author_url}'
```

These are defect observations, not a production repair manifest. Public snapshots can change after this session.

## Causal Trace

### 1. Legacy acquisition propagated rating identity without validation

The earliest committed media backfill inspected (`8156659`, 2026-03-08) reads `/api/ratings`, then uses `ratings[fs_id].igdb_id` for `/screenshots` and `/game_videos` queries. For a successful Nintendo gallery it takes Nintendo screenshots but chooses `youtube_videos or nintendo_media['videos']`. It still writes `source=nintendo`, so the top-level source does not establish the trailer's origin. Both Nintendo-success and IGDB-fallback branches build the link from `matched_title.lower().replace(' ', '-').replace(':', '')`. Applying that expression to the observed rating title produces exactly `blaster-master-zero-ex-character---shantae`. [S4]

The same unvalidated rating reuse, source substitution, and slug construction survived until the detail-upgrade rewrite in `2887f22`. The immediately preceding version shows those operations at lines 202-223. [S5]

**Inference, strongly supported:** a writer following this pattern produced the cached record. Its `last_updated` is March 7, one day before the earliest committed backfill examined; that prevents attributing this exact write to that commit or proving the original run sequence. A pre-commit run or another writer is possible.

### 2. Current rating safeguards do not migrate frozen legacy associations

The September worker searches up to ten candidates, requires original Switch evidence, compares edition/version signatures, requires similarity at least `0.88`, and rejects a tied best score. A pure local check of the actual title pair returned similarity `0.6440677966101694` and rejected the Shantae candidate even when given a synthetic Nintendo Switch platform. This particular pair would not pass the current matcher. [S6][S7]

However, existing ratings are selected for routine refresh only when the Nintendo release is less than two months old. The 2017 release is frozen. Its legacy record is merged back unchanged when updates are published. This is consistent with the explicit existing retention policy, not evidence of a scheduler failure. Confidence `100` is historical percentage format accepted for compatibility; it is not proof of a sound title match. [S6][S9]

The earlier replacement worker in `9582040` enriched only missing keys via a `0.70` title-only matcher. The actual pair's current similarity is below even that threshold. Neither implementation proves how the March association was initially chosen. [S7]

### 3. Current media retrieval validates assets, not the reused game identity

`scripts/media-backfill.py:229` still takes `igdb_id` directly from cached ratings. `fetch_igdb_media` first fetches screenshots/videos filtered by that ID, then queries only `fields url` on `/games`. It never compares the returned game's name, Switch platform, type, parent, or edition with the Nintendo record. Canonical URL retrieval fixes slug construction but can return a perfectly canonical URL for the **wrong game**. [S6]

The IGDB contract exposes game name, platforms, parent/version relations, URL, and `game_type`; `category` is deprecated. Screenshot/video records expose a game association. Provider-host checks and an eleven-character YouTube ID check establish URL/ID shape, not identity. [S10]

The existing Steam acquisition illustrates the missing boundary: a cached Steam ID is only a hint; details are rechecked for a unique exact normalized title, `type=game`, and publisher/developer agreement before assets are accepted. Reuse that validation principle, not Steam's platform rules. Do not require review scores to establish identity. [S11]

### 4. Two preservation layers keep suspect assets active

The Python `merge_media` begins with old screenshots, videos, and IGDB URL, then appends/deduplicates by `(type, video_id)`. On a source failure it preserves cached data. Even a successful corrected game response does not remove old video IDs. [S6]

Independently, `saveMedia` unions screenshots and calls `mergeVideos(old.videos, next.videos)`. Sending an empty or corrected-only video list through ordinary `/api/media` PUT therefore cannot retire `VCKtO0HTgAk`. Sending an explicit corrected `igdb_url` can replace the scalar link; omission leaves it unchanged. `If-Match` and Blob compare-and-swap prevent stale writes but do not validate association correctness. [S12][S13]

Current media types have provider-level provenance but no IGDB game identity on media entries; the validator allows legacy video provenance to be absent. Both card and detail consume `media.igdb_url` directly. The defect is upstream data lineage, not a YouTube-player or rendering problem. [S14][S15]

## Checks Performed

No scraper entry point or authenticated IGDB request was executed. A no-write Python probe extracted only `safe_url` and `merge_media` from the source AST, read the public target record, and supplied a synthetic corrected URL with empty media arrays. It printed:

```text
CURRENT_SIMILARITY 0.6440677966101694
CURRENT_CANDIDATE_ACCEPTED False
CORRECTED_URL https://www.igdb.com/games/blaster-master-zero LEGACY_VIDEO_RETAINED True
PURE_MERGE_REPRO_CONFIRMED
```

Assertions confirmed the old video and all six screenshots survived. This proves the Python retention mechanism, not a completed repair or a verified replacement IGDB ID. The server union is independently established by source inspection. [S6][S12]

Existing mocked checks also ran without bytecode writes:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest \
  automation.tests.test_media_backfill automation.tests.test_rating_refresh
```

Result: **12 tests passed, 0.006 seconds**. These cover source merging, failure retention, pagination, URL checks, refresh age, editions/platforms, and ambiguity, but do not exercise an incorrect cached IGDB identity or approved asset retirement. Existing API tests mock media storage, so they do not prove actual server merge behavior. [S16][S17]

## Narrow Approval-Ready Solution

### A. Code-only prevention, preserving every legacy record

Approve implementation of an IGDB identity-validation boundary before media acquisition, with local synthetic tests only. Treat cached rating ID as a candidate, not authority. Fetch its game metadata first; compare full normalized Nintendo title, original Switch platform, edition/version context, and game type/parent relation. Reuse the existing compatibility function; extend its shared evidence check to reject DLC/update records for a base-game target. Do not broadly exclude valid ports/remasters or blindly substitute a parent game. Exact title wins; fuzzy matching requires the existing supporting evidence and unique acceptance. Missing/ambiguous identity fails closed for **new IGDB assets**, without erasing cached media. [S6][S10]

Only after identity passes, acquire media and canonical `games.url`; include media-row game IDs in retrieval and assert the association. Retain a small optional `igdb_match` evidence record (ID, matched title, canonical URL, validation timestamp) and per-asset provenance, following the existing `steam_match` pattern. Missing evidence on legacy rows means **unverified**, not automatically invalid. Provider failure or malformed metadata must mark acquisition incomplete and preserve cached assets. No blanket legacy invalidation or all-catalog rematch.

This closes the unchecked-reuse path but **does not repair the existing production link or retire the video**. Keep routine rating age-freezing unchanged. Any targeted correction of the legacy rating must use explicit repair scope rather than deleting the rating to force routine refresh.

### B. Separate, reversible repair of `1204623` only

Approve this in stages, not as an implicit extension of code/deployment approval:

1. Approve bounded production-targeted provider acquisition for this one ID, explicitly naming environment and read-only acquisition/dry-run mode. Identify a unique validated base-game IGDB ID, canonical URL, and assets. No authenticated provider computation is authorized by this research request; replacement ID and asset list remain unverified.
2. Produce a fresh manifest for the Nintendo Deals production Blob store: exact `media.json`/`ratings.json` paths, only key `1204623`, before/after fields, every affected asset, retained counterpart, reason, counts, serialized payload bytes, snapshot revisions, and a named non-overwriting quarantine/backup destination. Byte counts refer to JSON unless actual remote media deletion is proposed. Do not download or delete provider-hosted media. Preserve all six Nintendo screenshot URLs and every unrelated map entry.
3. Choose trailer policy explicitly: **retain and relabel as an official Version 1.3 update trailer** (recommended absent stronger invalidity evidence), or quarantine it out of active media because only validated selected-game assets should be displayed. Stage a corrected media association only with validated replacement evidence. Retain raw legacy assets and the frozen rating by default; rating correction is not included in the parent's proposed prevention scope. Never silently recast the legacy trailer as newly verified base-game IGDB footage.
4. Require a later user message approving that exact manifest. A changed replacement match, asset set, snapshot, or scope resets approval. If video retirement is selected, ordinary additive media PUT is insufficient: use a reviewed one-time conditional single-record replacement with a verified recovery copy, reusing the existing Blob map/CAS helper and preserving unrelated keys. Do not add a generic force-overwrite API, globally replace media arrays, or weaken failure-retention behavior. The repair path is a proposal, not an existing verified command.
5. Keep the frozen rating unchanged. If a later, separately approved manifest explicitly includes rating correction, serialize that repair with its writer or use a reviewed conditional update path: the present ratings PUT replaces the whole map and has no revision guard. Do not submit a one-key payload or a stale full snapshot. Ratings and media are separate documents, not an atomic transaction; record partial completion and stop/reconcile safely if the second update conflicts. This is a future repair risk, not authorization to alter ratings. [S18]
6. Verify exact before/after differences by public GET, recoverability, unchanged unrelated entries and six screenshots, and approved trailer handling; then stop. No preference/curation/Steam mutation. Permanent deletion is unnecessary; if later requested it needs a second confirmation immediately before deletion.

**Current candidate scope, not an executable manifest:** one media entry with one incorrect link and one suspect video. Six Nintendo screenshots, raw legacy assets, and the frozen rating are retained by default. The incorrect rating association is evidence, not an approved repair target. Exact replacements, retirement choice, backup names/revisions, and bytes must be resolved before approval to mutate. Keeping the video requires no video retirement; replacing a link still requires a recoverable reviewed manifest.

## Required Tests Before A Repair Release

Extend the existing seams rather than add a new framework:

- Mock the complete acquisition path with Nintendo title `Blaster Master Zero` and cached rating `171205`; returned Shantae metadata must prevent screenshots/video requests and must preserve cached assets on rejection. Accept a synthetic exact base-game match with Switch/type evidence and canonical URL.
- Reject exact-looking DLC/update names, wrong platform/edition, tied candidates, absent metadata, mismatched returned IDs, mismatched media-row game IDs, malformed URL, and provider failure. Confidence `100` must never bypass identity validation.
- Keep ordinary Python/server additive merge tests proving legacy assets survive empty/partial refreshes. Add a real mocked-Blob storage check, not only API tests mocking `saveMedia`.
- If a repair path is approved, test that only the explicitly manifested link/video/rating changes, six screenshots and unrelated entries survive, quarantine is non-overwriting/recoverable, and stale revisions cannot retire data. Cover missing/invalid authorization, malformed evidence, missing revision, conflict, and recovery after partial two-document completion.
- Use a synthetic local card/detail fixture to verify the canonical base-game link and chosen trailer label/retirement. No production browser mutation tests.

Before implementation, update existing affected specifications with stable IDs **FR-004, FR-009, NFR-006, UC-002, UC-004**, and explicitly distinguish age-freezing and provider-failure preservation from approved correction of a known-bad association. Retain **C-010/UC-004 BR-004** except for an explicit single-game repair exception. Run the repository AIUP checker and relevant Python/Vitest/type/build gates after implementation; none is claimed green for an unimplemented fix. [S9][S19]

## Limits And Decision

IGDB's add-on page could not be read by the web tool; its base-game page returned no extractable body. The YouTube watch-page reader also failed, but public oEmbed succeeded. No authenticated IGDB ID lookup or original March execution artifact was acquired. No verified replacement numeric IGDB ID, provider ownership history, complete retirement manifest, or production repair is claimed.

Approve **A only** for code-only prevention, or **A plus preparation of B** for bounded, explicitly authorized single-game acquisition and a later manifest review. Neither authorizes production publication or retirement. Scheduling, missing enrichment, focus defects, and broader audits are outside this note.

Reflection: preservation is not validation. Retain uncertain legacy assets on provider failure, but never treat their preserved presence or top-level provider label as fresh game-identity evidence. This is a source-policy/spec clarification, not a reason to edit agent instructions or skills.

## Sources

- [S1: Public production media snapshot](https://nintendo-deals.vercel.app/api/media), selected key `1204623`, retrieved 2026-09-30.
- [S2: Public production ratings snapshot](https://nintendo-deals.vercel.app/api/ratings), selected key `1204623`, retrieved 2026-09-30.
- [S3: Exact-ID Nintendo ES Solr record](https://searching.nintendo-europe.com/es/select?q=*&fq=type%3AGAME%20AND%20fs_id%3A1204623&rows=1&wt=json&fl=fs_id,title,title_master_s,pretty_date_s,dates_released_dts,publisher,system_type,url), retrieved 2026-09-30.
- [S4: Earliest inspected committed media backfill](https://github.com/vozer/nintendo-deals/blob/8156659/scripts/media-backfill.py#L161), media requests at lines 65-95; link/video/source assembly at lines 195-230. Commit date from local Git history: 2026-03-08.
- [S5: Last pre-upgrade media acquisition](https://github.com/vozer/nintendo-deals/blob/2887f22%5E/scripts/media-backfill.py#L197), inspected with local `git show 2887f22^:scripts/media-backfill.py`.
- [S6: Current media acquisition](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/scripts/media-backfill.py#L76), pure merge at line 131; selection/reused rating at lines 215-241; [current rating eligibility and compatibility](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/automation/run_daily.py#L322), update merge at line 575.
- [S7: Current pure title matcher](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/automation/nintendo_worker.py#L16); [September replacement worker](https://github.com/vozer/nintendo-deals/blob/9582040/automation/run_daily.py#L160). Local history did not contain the original recovered n8n rating graph; project instructions explicitly identify that graph as unrecovered.
- [S8: YouTube public oEmbed metadata](https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DVCKtO0HTgAk&format=json), retrieved using public GET; [cached video](https://www.youtube.com/watch?v=VCKtO0HTgAk).
- [S9: UC-004 age-gated refresh and compatibility policy](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/docs/use_cases/UC-004-refresh-deal-intelligence.md#L87).
- [S10: Official IGDB games fields](https://api-docs.igdb.com/#game), [game types](https://api-docs.igdb.com/#game-type), [game videos](https://api-docs.igdb.com/#game-video), and [screenshots](https://api-docs.igdb.com/#screenshot), consulted 2026-09-30. Use `game_type` rather than hard-coded deprecated category enums.
- [S11: Validated Steam acquisition](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/scripts/steam-backfill.py#L79).
- [S12: Server media union](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/lib/media-storage.ts#L15) and [video merge](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/lib/game-presentation.ts#L3).
- [S13: Media API publication guard](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/app/api/media/route.ts#L20) and [Blob map conditional update](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/lib/blob-json.ts#L10).
- [S14: Media types](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/lib/types.ts#L61) and [media snapshot validator](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/lib/snapshot-validation.ts#L45).
- [S15: Card IGDB link](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/components/GameCard.tsx#L250) and [detail link input](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/components/GameDetailModal.tsx#L32).
- [S16: Existing media tests](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/automation/tests/test_media_backfill.py) and [rating tests](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/automation/tests/test_rating_refresh.py).
- [S17: Existing API tests mock media storage](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/app/api/enrichment/route.test.ts#L11).
- [S18: Whole-map ratings publication](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/app/api/ratings/route.ts#L34) and [ratings storage overwrite](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/lib/ratings-storage.ts#L15).
- [S19: Existing requirements and detail-upgrade source policy](https://github.com/vozer/nintendo-deals/blob/e72fba4ef501c4103e7cde12f0e042208e992e1e/docs/requirements.md#L28).
