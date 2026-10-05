# Detail Remediation: Implementation and Crawler Evidence

## Scope

User approved matching/focus/presentation repairs but rejected new scheduled enrichment orchestration: use the existing crawler instead. No new GitHub Actions workflow/job/schedule or service was added. Stable affected IDs: FR-004/FR-009, NFR-009; UC-002/UC-004; GAME_MEDIA/MEDIA_ASSET. At initial handoff, code/specification changes were local. The UI/code portion was later committed and deployed in `f58ab2e` on 2026-10-05; crawler publication remains separate.

Initial staging investigated Nintendo IDs `3151132` and `1204623` against `https://nintendo-deals.vercel.app`, using the existing media CLI and authenticated IGDB acquisition. That two-game exploration was superseded by the user's 2026-10-01 approval for a full currently eligible original-Switch catalog crawl, recorded in [the full media crawl plan](2026-10-01-full-media-crawl.md). No production apply, preference write, rating update, Telegram send, webhook change or credential rotation occurred.

## Implemented

- Cached IGDB rating ID is only a candidate. Fetch game identity before screenshots/videos; validate original Switch platform, title/edition, supported game type and parent/version relation. Rejected cached candidates use a bounded search; tied or unverified matches do not acquire IGDB assets. Media-row game IDs must agree with validated identity. Frozen rating scores remain untouched.
- Optional media `igdb_match` and `legacy_igdb_url` preserve validation evidence and recovery of replaced associations. Existing screenshots/videos are retained by ordinary additive merge. Snapshot validation checks trusted/canonical identity URL consistency and rejects malformed evidence.
- Detail cleanup restores a connected usable opener and otherwise the existing search input; failed focus restoration also falls back. No custom focus library. Empty media strips are omitted; expired/non-sale NT Deals context receives a historical label.
- Existing crawler adds optional `--output <new-file>` for before/after staged records, revision and payload bytes. Existing output files cannot be overwritten. Provider errors report their class without credential-bearing URLs and preserve cached assets.

## Tests

- Regression reproduced before repair: local deep-link Escape failed focus assertion at 375px and 1200px.
- Four local Playwright tests now pass: deep-link Escape/close-button search focus, removed-opener fallback, shared persisted actions, source links, actual synthetic HLS playback, historical context, empty strip exclusion, responsive layouts and axe checks.
- 63 TypeScript tests, 15 files: passed. Includes verified IGDB evidence acceptance and invalid/canonical mismatch denial, existing auth and conditional-write API tests.
- 59 Python tests: passed. Adds cached add-on rejection before media requests, unique base-game fallback, wrong-platform/type/parent/tied-match rejection, mismatched media-row exclusion and preservation of old screenshots/videos/link. The CLI boundary test stages exact before/after records, makes no API writes/preferences calls, and refuses to overwrite an existing output file.
- Lint, TypeScript no-emit, production build, AIUP checker and diff whitespace checks: passed under Node 24.21.0. Build and AIUP gates were repeated after the optional crawler-output change; CLI help and its focused Python tests passed. No new schedule or workflow change exists.

## Exact Production Staging Manifest (Not Publication Approval)

Target: existing Nintendo Deals production private Blob map `media.json`, accessed through `/api/media`. Only these two keys were acquired; existing 2,495-record snapshot remains unchanged. No hosted image/video file is downloaded, deleted or moved.

Snapshot revision for both staging reads: `"e2425ce64ab0fa8ffbcdae6cd4ea55753b371743c71bd413fb4888c99b0ac7ff"`. A newer revision requires reconciliation/restaging rather than bypassing If-Match.

| Key | Before | Staged after | Removed assets | One-key payload bytes |
|---|---|---|---|---|
| `3151132` Future Knight | No media record | 36 images, five videos; validated IGDB `388341`, Steam `4235410` (Aeternum Game Studios); complete collection | 0 | 12,436 |
| `1204623` Blaster Master Zero | Six images, one video; Shantae add-on IGDB URL | 18 images, five videos; validated base-game IGDB `27438`; original six images and update video retained; previous URL retained in `legacy_igdb_url` | 0 | 5,563 |

Retained counterpart for the incorrect link: `legacy_igdb_url=https://www.igdb.com/games/blaster-master-zero-ex-character---shantae`. New active link: `https://www.igdb.com/games/blaster-master-zero`. Future Knight canonical IGDB URL: `https://www.igdb.com/games/future-knight--1`. Steam assets for Blaster Master Zero were not acquired as a newly validated media match; the existing Steam rating/link is unchanged. Do not claim every provider exposes or supplied every possible asset.

Full before/after entries, including every asset URL, are retained in non-overwriting local staging files:

- `/var/folders/b3/33_vf9ds17s7prkc15xpxn9r0000gn/T/nd-media-stage-20261001-kIIjI1/3151132.json`
- `/var/folders/b3/33_vf9ds17s7prkc15xpxn9r0000gn/T/nd-media-stage-20261001-kIIjI1/1204623.json`

These are JSON recovery/staging records, not downloads of remote media. Counts/bytes above refer to JSON publications. The combined publication payload must be serialized and checked before applying; the two single-key byte counts cannot simply be presented as the byte length of a combined map. A reviewed non-overwriting durable recovery copy is required before replacing an existing association.

Production preferences SHA-256 matched before/after acquisition: 157 hidden, 11 watched, four Thinking. No preferences API write occurred. Production now runs code `f58ab2e`; deployment did not publish the crawler's staged media or modify the production `media.json` snapshot.

## Remaining Approval and Validation

- Full currently eligible original-Switch crawl scope is approved. Full-catalog selection includes active discounted original Switch games within the existing price/language/digital policy; targeted ID mode can inspect a non-sale original Switch game.
- Exact reviewed manifest approval is required before the existing link replacement. A broad instruction to update does not authorize deleting assets or bypassing revision checks. No bulk legacy migration or frozen-rating rematch is included.
- Code commit/push/deployment completed as `f58ab2e`; production alias is Ready. The full-catalog crawl and any publication remain separate: require a successful complete crawl, exact reviewed manifest and current If-Match revision before `--apply`. After publication, run read-only real-source image/video/link and focus checks. Do not use production preference-mutation tests.

Reflection: the user's correction removed unnecessary scheduling work. Keep render fixes, existing acquisition, validated identity and production publication evidence separate; actual crawler staging is complete but is not an applied production repair.
